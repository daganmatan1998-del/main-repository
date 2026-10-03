/* =====================================================================
   J.A.R.V.I.S. — Cloudflare Worker backend
   =====================================================================

   Every secret lives here, as a Worker secret. Nothing sensitive is ever
   sent to the browser.

   Required secrets (wrangler secret put NAME):
     JARVIS_PIN            the PIN you type on the auth gate
                           (AUTH_PIN is accepted too, if that is what you have)
     JARVIS_TOKEN_SECRET   any long random string — signs session tokens
                           (SESSION_SECRET is accepted too)
     ANTHROPIC_API_KEY     sk-ant-...

   Optional secrets — each feature simply switches itself off if missing:
     CARTESIA_API_KEY      sk_car_...        → voice
     CARTESIA_VOICE_ID     a voice uuid      → voice (has a default)
     SHOPIFY_STORE         e.g. ovrea         → single-store tools (see SHOPIFY_STORES below)
     SHOPIFY_ADMIN_TOKEN   shpat_...          → single-store tools
     GOOGLE_CLIENT_ID                        → calendar (then say "connect my calendar")
     GOOGLE_CLIENT_SECRET                    → calendar
     GOOGLE_REFRESH_TOKEN                    → calendar, optional: connecting from the app replaces it
     ALLOWED_ORIGIN        https://your.site → CORS lock (defaults to *)
     WHATSAPP_PHONE        his own number, e.g. 0552813729 or +972552813729
     CALLMEBOT_APIKEY      the key CallMeBot sends back on WhatsApp
                           → both together: send_whatsapp, to him and only him
     CALL_USER             optional: a Telegram @username or phone number to ring.
                           Without it, calls ring WHATSAPP_PHONE. Calls need no
                           key — only a one-time /start to @CallMeBot_txtbot.
     JARVIS_DB             a D1 database BINDING (not a secret) → messages for
                           later. With a Cron Trigger of "* * * * *" on this
                           worker they go out on time with the computer off.
     PRIMARY_API_KEY       AIza/gsk_/sk-or-... → try THIS before Anthropic. Put a
                           free-tier key here and Anthropic becomes the safety
                           net instead of the meter.
     PRIMARY_MODEL         optional override (inferred from the key prefix)
     PRIMARY_API_URL       optional override (inferred from the key prefix)
     FALLBACK_API_KEY      another key         → tried after Anthropic
     FALLBACK_API_KEY_2    and another         → tried after that
     FALLBACK_API_KEY_3    and another         → every free tier has a daily
                           ceiling, so two or three in a row is what makes a
                           free backend dependable rather than free until 4pm
     FALLBACK_MODEL[_2/_3] optional overrides
     FALLBACK_API_URL[_2/_3] optional overrides
     SHOPIFY_STORES         JSON array for MORE THAN ONE store, e.g.
                            [{"name":"ovrea","store":"ovrea","token":"shpat_..."},
                             {"name":"aura","store":"aura-store-9f2","token":"shpat_..."}]
                            "name" is what the user calls it in conversation and
                            what shopify_admin_query expects as store_name; "store"
                            is the *.myshopify.com subdomain, which is often
                            different from the storefront's public name. When this
                            is set it is the full list — SHOPIFY_STORE/_ADMIN_TOKEN
                            are folded in automatically if they are also present,
                            so nothing already configured stops working.

   Endpoints:
     POST /auth/pin            { pin }                  → { ok, token }
     POST /                    Anthropic messages proxy (streams if stream:true)
     POST /v1/messages         same thing, explicit path
     POST /tts                 { text, language }       → audio/wav
     POST /image               { prompt, reference? }   → { image: base64 }
     POST /mcp/<name>          proxy to a remote MCP server, adding its own auth header
     GET  /calendar/upcoming?days=7                     → { calendar, events: [...] }
     POST /calendar/create     { title, start, end, ... } → { ok, calendar, event }
     POST /calendar/connect                             → { url } Google's consent screen
     GET  /calendar/oauth      (Google's redirect back; public, signed state)
     POST /youtube/connect                              → { url } Google's consent (youtube.readonly)
     GET  /youtube/oauth       (Google's redirect back; public, signed state)
     POST /youtube/playlist    { name? }                → { url } of the jarvis playlist from its
                               first video, or { code, tell_the_user }
     POST /stt                 audio bytes              → { text } (Groq Whisper
                               first when a gsk_ key exists, Workers AI behind it)
     POST /shopify/query      { query, variables }     → GraphQL result
     POST /whatsapp/send       { text, send_at? }       → sends now, or queues it
     POST /call/start          { text, send_at? }       → rings him now, or queues it
     GET  /outbox/scheduled                             → { pending, recent }, both kinds
     POST /outbox/cancel       { id }                   → { ok }
     GET  /health                                       → capability report
     GET  /session                                      → { ok:true } if the token
                               is good. Costs nothing and calls nobody, so the
                               page can check a stored token before trusting it.
     POST /fallback/test       (no body)              → { ok, engines: [...] } — asks
                               every configured engine, before you need them
   ===================================================================== */

const WORKER_VERSION = '2.9.1';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_VOICE_ID = 'ef191366-f52f-447a-a398-ed8c0f2943a1';
const SHOPIFY_API_VERSION = '2025-07';

/* This account already had its secrets set up under different names, so accept
   either spelling rather than making anyone re-enter them. New name first, then
   the one that is already there. */
function pinSecret(env)   { return env.JARVIS_PIN || env.AUTH_PIN || ''; }
function tokenSecret(env) { return env.JARVIS_TOKEN_SECRET || env.SESSION_SECRET || ''; }

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env, request) });

    try {
      if (path === '/health' || (path === '/' && request.method === 'GET')) {
        return json(await health(env), 200, env, request);
      }
      if (path === '/auth/pin')     return await handleAuth(request, env);
      /* Google's redirect back after he approves the calendar: it carries
         no token of ours, only the signed state that handler checks. */
      if (path === '/calendar/oauth') return await handleCalendarOAuth(request, env, url);
      /* Google's redirect back for YouTube (2.9.0), the same way. */
      if (path === '/youtube/oauth')  return await handleYoutubeOAuth(request, env, url);

      const authed = await requireToken(request, env);
      if (!authed) return json({ error: 'unauthorized' }, 401, env, request);

      if (path === '/' || path === '/v1/messages') return await handleMessages(request, env);
      if (path === '/tts')                         return await handleTts(request, env);
      if (path === '/model3d')                     return await handleModel3d(request, env);
      if (path === '/model3d/status')              return await handleModel3dStatus(request, env);
      if (path === '/model3d/check')               return await handleModel3dCheck(request, env);
      if (path === '/image')                       return await handleImage(request, env);
      if (path === '/stt')                         return await handleStt(request, env);
      if (path === '/fetch')                       return await handleFetch(request, env);
      if (path === '/search')                      return await handleSearch(request, env);
      if (path.indexOf('/mcp/') === 0)             return await handleMcpProxy(request, env, path);
      if (path === '/calendar/upcoming')           return await handleCalendarUpcoming(request, env, url);
      if (path === '/calendar/create')             return await handleCalendarCreate(request, env);
      if (path === '/calendar/connect')            return await handleCalendarConnect(request, env, url);
      if (path === '/youtube/connect')             return await handleYoutubeConnect(request, env, url);
      if (path === '/youtube/playlist')            return await handleYoutubePlaylist(request, env);
      if (path === '/shopify/query')               return await handleShopify(request, env);
      if (path === '/whatsapp/send')               return await handleOutboxSend(request, env, ctx, 'whatsapp');
      if (path === '/call/start')                  return await handleOutboxSend(request, env, ctx, 'call');
      /* The /whatsapp/ names are what a page from before calls existed asks
         for; the site and the worker are deployed separately. */
      if (path === '/outbox/scheduled' || path === '/whatsapp/scheduled') return await handleOutboxList(request, env);
      if (path === '/outbox/cancel'    || path === '/whatsapp/cancel')    return await handleOutboxCancel(request, env);
      if (path === '/fallback/test')               return await handleFallbackTest(env, request);
      if (path === '/session')                     return json({ ok: true }, 200, env, request);

      /* AGENTS — see the block at the end of the file. The registry is read
         through the same auth every other authed route uses; nothing here
         is more sensitive than the tool calls it merely describes. */
      if (path === '/agents')                      return await handleAgentsList(request, env);
      if (path === '/agents/brand')                return await handleBrandProfile(request, env);
      if (path === '/approvals/request')            return await handleApprovalRequest(request, env);
      if (path === '/approvals/pending')            return await handleApprovalList(request, env, url);
      if (path === '/approvals/decide')             return await handleApprovalDecide(request, env);
      if (path === '/events/recent')                return await handleEventsRecent(request, env, url);
      if (path === '/memory' && request.method === 'GET')  return await handleMemoryRead(request, env, url);
      if (path === '/memory')                       return await handleMemoryWrite(request, env);
      if (path === '/agent/pause')                  return await handleAgentPause(request, env);
      if (path === '/agents/config')                return await handleAgentConfig(request, env, url);
      if (path === '/qa/check')                     return await handleQaCheck(request, env);

      return json({ error: 'not found: ' + path }, 404, env, request);
    } catch (err) {
      return json({ error: String((err && err.message) || err) }, 500, env, request);
    }
  },

  /* The Cron Trigger. This is what makes "at 4pm" happen with the computer
     off: nothing on his side is involved, Cloudflare wakes the worker every
     minute and it sends whatever has come due. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runOutbox(env).catch(err => console.error('outbox', err)));
    /* The scheduled agents (competitor, news) and the daily summary, on the
       same timer. A tick that only sends WhatsApp is now also the tick that
       asks "is anything else due" — one Cron Trigger, not two, because
       Cloudflare bills and limits them per worker regardless of how many
       different things they end up doing. */
    ctx.waitUntil(runDueAgents(env).catch(err => console.error('agents', err)));
  }
};

function cors(env, request) {
  const allowed = env.ALLOWED_ORIGIN || '*';
  const origin = request ? request.headers.get('Origin') : null;
  const value = allowed === '*' ? (origin || '*') : allowed;
  return {
    'Access-Control-Allow-Origin': value,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Jarvis-Token, Authorization, anthropic-version, anthropic-beta',
    /* Without this the page cannot READ a single one of the X-Jarvis-* headers
       below: a cross-origin response only exposes a handful of safelisted
       headers unless the server names the rest here. Everything the worker was
       trying to tell the page about itself — which engine answered, that it had
       fallen back to another model, that an image was dropped — arrived and was
       then discarded by the browser. That is why the debug line said
       "engine=unknown" while the worker knew perfectly well which engine it was. */
    'Access-Control-Expose-Headers': 'X-Jarvis-Engine, X-Jarvis-Fallback, X-Jarvis-Voice, X-Jarvis-Blind, X-Jarvis-Blind-Why, X-Jarvis-Vision',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(obj, status, env, request) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...cors(env, request) }
  });
}

function b64urlEncode(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const pad = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}
async function mintToken(env) {
  const payload = JSON.stringify({ exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS, v: 1 });
  const encoded = b64urlEncode(new TextEncoder().encode(payload));
  const sig = b64urlEncode(await hmac(tokenSecret(env) || 'dev-secret', encoded));
  return encoded + '.' + sig;
}
async function verifyToken(env, token) {
  if (!token || token.indexOf('.') < 0) return false;
  const [encoded, sig] = token.split('.');
  const expected = b64urlEncode(await hmac(tokenSecret(env) || 'dev-secret', encoded));
  if (sig.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(encoded)));
    return payload.exp > Math.floor(Date.now() / 1000);
  } catch (e) { return false; }
}
function bearerToken(request) {
  const auth = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return m ? m[1].trim() : '';
}

async function requireToken(request, env) {
  const candidates = [
    request.headers.get('X-Jarvis-Token') || '',
    bearerToken(request)
  ];
  try {
    const q = new URL(request.url).searchParams.get('t');
    if (q) candidates.push(q);
  } catch (e) {}
  for (const token of candidates) {
    if (token && await verifyToken(env, token)) return true;
  }
  return false;
}

async function handleAuth(request, env) {
  const body = await request.json().catch(() => ({}));
  const pin = String((body && body.pin) || '');
  const real = String(pinSecret(env));
  if (!real) return json({ error: 'no PIN configured: set JARVIS_PIN (or AUTH_PIN)' }, 500, env, request);
  let diff = pin.length ^ real.length;
  for (let i = 0; i < Math.max(pin.length, real.length); i++) {
    diff |= (pin.charCodeAt(i) || 0) ^ (real.charCodeAt(i) || 0);
  }
  if (diff !== 0) return json({ ok: false }, 200, env, request);
  return json({ ok: true, token: await mintToken(env) }, 200, env, request);
}

async function health(env) {
  const missing = [];
  const chain = engineChain(env);
  if (!chain.length) missing.push('PRIMARY_API_KEY or ANTHROPIC_API_KEY');
  if (!pinSecret(env))        missing.push('JARVIS_PIN (or AUTH_PIN)');
  if (!tokenSecret(env))      missing.push('JARVIS_TOKEN_SECRET (or SESSION_SECRET)');

  return {
    ok: true,
    version: WORKER_VERSION,
    max_tokens: 'passthrough',
    using: {
      pin: env.JARVIS_PIN ? 'JARVIS_PIN' : (env.AUTH_PIN ? 'AUTH_PIN' : null),
      token: env.JARVIS_TOKEN_SECRET ? 'JARVIS_TOKEN_SECRET' : (env.SESSION_SECRET ? 'SESSION_SECRET' : null)
    },
    brain: chain.length > 0,
    engines: chain.map(e => e.label),
    /* Whether anything in the chain can actually LOOK at a picture.
       Reported here so the page can say so when the camera opens, rather
       than letting him hold something up, wait, and be told afterwards
       that it never arrived. The name of the first seeing engine comes
       with it, because "which one" is the next question. */
    /* Two ways to see, and the page needs to know which it has: an engine
       that looks at the pixels itself, or a vision model writing a
       description for one that cannot. Both beat "I cannot see images";
       they are not the same thing and are not reported as the same. */
    vision: chain.some(e => e.vendor === 'anthropic' || engineSeesImages(e, env)) || !!env.AI,
    vision_via: chain.some(e => e.vendor === 'anthropic' || engineSeesImages(e, env))
      ? 'engine' : (env.AI ? 'described' : false),
    vision_engine: (chain.find(e => e.vendor === 'anthropic' || engineSeesImages(e, env)) || {}).label || null,
    vision_describer: env.AI ? describersFor(env)[0].model : null,
    /* How he is heard (2.8.0): Groq's Whisper first when a gsk_ key exists
       anywhere in the worker (named, never the value), Workers AI behind it. */
    stt_via: groqSttKey(env) ? 'groq' : (env.AI ? 'workers-ai' : false),
    stt_groq_key_name: (groqSttKey(env) || {}).name || null,
    voice: !!(env.CARTESIA_API_KEY || env.AI),
    voice_via: env.CARTESIA_API_KEY ? 'cartesia' : (env.AI ? 'workers-ai' : false),
    model3d: !!model3dProvider(env),
    /* Which service makes the models (2.7.0): 'tripo', 'meshy', or null. */
    model3d_provider: model3dProvider(env),
    /* Whether the key LOOKS right, never the key: missing, set, or set but
       not shaped like that service's keys (Tripo's begin tsk_, Meshy's
       msy_). The name it was found under, and whether it had to be cleaned
       (quotes, spaces, "Bearer"), so a secret stored slightly wrong can be
       seen from the page. Describes the ACTIVE provider's key. */
    model3d_key: (() => { const k = model3dKeyInfo(env); return !k.key ? 'missing' : k.looksRight ? 'set' : (k.provider === 'tripo' ? 'not_tsk' : 'not_msy'); })(),
    model3d_key_name: model3dKeyInfo(env).name || null,
    model3d_key_cleaned: model3dKeyInfo(env).cleaned,
    model3d_check: true,      // present only on workers that carry /model3d/check
    images: !!env.AI,
    stt: !!(env.AI || groqSttKey(env)),
    read_page: true,          // present only on workers that carry /fetch
    search: true,             // /search — engine-agnostic, needs no Anthropic key
    stt_language_hint: true,   // present only on workers that accept ?language=
    /* Music (2.9.0): YouTube, from JARVIS_PLAYLIST or the Google client
       (the connection itself is checked by /youtube/playlist). */
    youtube: youtubeConfigured(env),
    youtube_playlist_fixed: !!playlistIdFrom(env.JARVIS_PLAYLIST || env.YOUTUBE_PLAYLIST),
    /* Present only on workers that DETECT the language first and treat the
       hint as a second opinion. The page gates on this: an older worker
       feeds ?language= straight to Whisper as a lock, which is what made
       English spoken into a Hebrew-set interface come back as "Thank you".
       So the page sends the hint only where it is safe to send. */
    stt_detect_first: true,
    fallback: chain.length > 1 ? chain[1].model : false,
    fallback_via: chain.length > 1 ? chain[1].vendor : false,
    mcp: Object.keys(env)
      .filter(k => /^MCP_[A-Z0-9_]+_URL$/.test(k))
      .map(k => k.slice(4, -4).toLowerCase()),
    shopify: shopifyStores(env).map(s => s.name),
    /* The admin handle beside the friendly name, so a deep link can be built
       instead of guessed. admin.shopify.com/store/<handle> needs the
       myshopify subdomain, and with SHOPIFY_STORES the configured name is a
       label \u2014 "Glowpulse" \u2014 which is not it. Without this the page
       has to ask him for a URL it already knows, which was exactly what he
       asked never to be asked for.

       Not a secret: the handle is in the address bar of every admin page he
       has open. The token, which is the secret, stays here. */
    shopify_stores: shopifyStores(env).map(s => ({
      name: s.name,
      handle: String(s.store || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/\.myshopify\.com$/, '')
    })),
    calendar: await calendarConfigured(env),
    /* Whether "connect my calendar" can work at all yet. Whose calendar it
       is — an email address — is deliberately not here: /health answers
       anyone. Every authed calendar reply names it instead. */
    calendar_can_connect: calendarClientConfigured(env),
    whatsapp: whatsAppConfigured(env),
    /* Names only, never values, so "I can't send messages" can become "the
       worker is missing CALLMEBOT_APIKEY" — the difference between a dead
       end and a thirty-second fix. */
    whatsapp_missing: [
      whatsAppPhone(env) ? null : (env.WHATSAPP_PHONE ? 'WHATSAPP_PHONE (not a valid phone number)' : 'WHATSAPP_PHONE'),
      env.CALLMEBOT_APIKEY ? null : 'CALLMEBOT_APIKEY'
    ].filter(Boolean),
    /* Masked: /health answers anyone, and his number is his. The last four
       digits are enough for JARVIS to say which phone it is going to. */
    whatsapp_to: whatsAppConfigured(env) ? maskPhone(whatsAppPhone(env)) : null,
    call: callConfigured(env),
    call_to: callConfigured(env) ? maskTarget(callTarget(env)) : null,
    call_missing: callConfigured(env) ? [] : ['CALL_USER (or WHATSAPP_PHONE)'],
    whatsapp_later: !!env.JARVIS_DB,
    /* Whether the Cron Trigger is really firing, read from the last time it
       did rather than assumed. A queue with no cron behind it is a promise
       that silently never arrives, which is worse than an error. */
    whatsapp_cron: env.JARVIS_DB ? await cronAlive(env) : false,
    missing: missing
  };
}

async function handleMessages(request, env) {
  let chain = engineChain(env);
  if (!chain.length) {
    return json({ error: 'no model configured: set PRIMARY_API_KEY or ANTHROPIC_API_KEY' }, 500, env, request);
  }
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'invalid JSON body' }, 400, env, request);

  const wantsServerTool = (body.tools || []).some(t => t && t.type && !t.input_schema);
  if (wantsServerTool) {
    const anthropicFirst = chain.filter(e => e.vendor === 'anthropic');
    if (anthropicFirst.length) {
      chain = anthropicFirst.concat(chain.filter(e => e.vendor !== 'anthropic'));
    }
  }

  liftToolResultImages(body);
  const hasImage = (body.messages || []).some(m =>
    Array.isArray(m.content) && m.content.some(b => b && b.type === 'image'));
  let describedBy = null;
  let describeTried = false;
  const describeFailures = [];
  if (hasImage) {
    const seeing = chain.filter(e => e.vendor === 'anthropic' || engineSeesImages(e, env));
    if (seeing.length) {
      chain = seeing.concat(chain.filter(e => seeing.indexOf(e) < 0));
    } else {
      /* Nothing here can look at it. Rather than strip the picture and
         apologise, have a model that CAN see write down what is in it, and
         hand that to the one that is answering. Done once, before any
         engine is tried, so a failover does not re-describe. */
      describedBy = await describeImagesInBody(body, env, describeFailures);
      describeTried = true;
    }
  }

  return runEngineChain(chain, body, env, request, describedBy, describeTried, describeFailures);
}

/* THE ACTUAL CALL, DOWN THE CHAIN — pulled out of handleMessages so the
   agent runner below can put its own system prompt and tools through the
   exact same fallback machinery rather than reimplementing it. Nothing
   about handleMessages' behaviour changes: this is its own loop, moved
   here verbatim, with the two callers now sharing it. */
async function runEngineChain(chain, body, env, request, describedBy, alreadyTriedDescribing, describeFailures) {
  const skipped = [];
  let lastError = null;

  /* Two passes: everything that is awake, then — only if something was
     skipped — the ones that were resting, because a five-minute cooldown is
     a guess about a provider's state, not a fact, and being wrong about it
     is worse than one extra call when nothing else answered.

     Which engines pass 2 revisits has to be decided HERE, before any of them
     runs. Selecting them with cooling() at the time meant a failure in pass 1
     put that engine on cooldown and pass 2 then read the cooldown it had just
     set as "was resting, try it" — so every engine that failed was called a
     second time, back to back, in the same request. Twice the latency and
     twice the quota, at exactly the moment the user is already waiting. */
  const resting = chain.filter(engine => cooling(engine));
  const awake = chain.filter(engine => !cooling(engine));

  /* A picture, and the engines that can see it have all failed. The one
     about to answer cannot, and would have had the picture stripped out
     from under it. Described instead — once, on a copy, so an engine that
     CAN see and comes later (pass 2) still gets the real thing. */
  let described = null;
  let describeTried = !!alreadyTriedDescribing;   // a describer that just failed is not asked twice
  /* Why no describer could help, when none could — sent with the blind
     answer so the page can say it, instead of him just saying "a backend
     limitation" with nobody able to tell which one. */
  const failures = describeFailures || [];

  for (const group of [awake, resting]) {
    for (let i = 0; i < group.length; i++) {
      const engine = group[i];
      let sendBody = body, sendDescribedBy = describedBy;
      if (!describedBy && imageWillBeDropped(engine, body, env)) {
        if (!describeTried) {
          describeTried = true;
          const copy = JSON.parse(JSON.stringify(body));
          const by = await describeImagesInBody(copy, env, failures);
          if (by) described = { body: copy, by: by };
        }
        if (described) { sendBody = described.body; sendDescribedBy = described.by; }
      }
      const attempt = await callEngine(engine, sendBody, env, request, group !== awake || i > 0, sendDescribedBy,
                                       describeFailureSummary(failures));
      if (attempt.ok) { clearCooldown(engine); return attempt.response; }

      if (!attempt.retriable) return attempt.response;
      setCooldown(engine);
      skipped.push(engine.label + ': ' + attempt.reason);
      lastError = attempt;
    }
  }

  return json({
    code: 'all_engines_down',
    tried: skipped,
    reason: (lastError && lastError.reason) || 'unknown',
    vendor: (lastError && lastError.engine && lastError.engine.vendor) || '?',
    model: (lastError && lastError.engine && lastError.engine.model) || '?',
    error: 'Every configured model is unavailable — ' + skipped.join('; ')
  }, 502, env, request);
}

/* The system prompt and the tool schemas are byte-identical from one request
   to the next — roughly four thousand tokens of them — and they were being
   re-sent and re-billed every single time. Marking a cache breakpoint after
   them is what that costs: Anthropic caches everything before the breakpoint
   (tools first, then system, in that order), and subsequent requests read the
   prefix back at a fraction of the price instead of paying to reprocess it.

   Done HERE rather than in the page, deliberately. The page does not know
   which engine will answer; the worker does. So the caching marker only ever
   reaches Anthropic, and Google, Groq, Cerebras, xAI and Workers AI never see
   a field they would not understand.

   It also stays fail-safe. If Anthropic ever rejects the marker, callEngine
   retries once with the original untouched body rather than failing the turn
   — a caching optimisation must never be the reason an answer does not
   arrive. */
function withCaching(body) {
  if (!body || typeof body.system !== 'string' || !body.system) return body;
  /* Below roughly a thousand tokens there is nothing worth caching and the
     marker is refused; ~4 chars per token is rough but the floor here is far
     above it either way. */
  if (body.system.length < 4000) return body;
  return {
    ...body,
    system: [{ type: 'text', text: body.system, cache_control: { type: 'ephemeral' } }]
  };
}

function looksLikeCacheComplaint(status, detail) {
  return status === 400 && /cache_control|cache|ephemeral/i.test(String(detail || ''));
}

/* system arrives as a plain string from the page, but withCaching turns it
   into blocks — and a failover to an OpenAI-compatible engine then passes
   that array through here. String(array) yields "[object Object]", which
   would have handed the model a system prompt made of nothing. */
function systemText(system) {
  if (!system) return '';
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system.map(b => (b && typeof b.text === 'string') ? b.text : '').join('\n').trim();
  }
  return String(system);
}

async function callEngine(engine, body, env, request, announce, describedBy, blindWhy) {
  /* Workers AI is a binding, not an endpoint: no fetch, no key, no streaming
     to convert. Handled up front so the HTTP path below stays untouched. */
  if (engine.vendor === 'workers-ai') return await callWorkersAI(engine, body, env, request, announce, describedBy, blindWhy);
  const anthropicBody = engine.vendor === 'anthropic' ? withoutThoughtSignatures(body) : body;
  let upstream;
  try {
    upstream = engine.vendor === 'anthropic'
      ? await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': engine.key,
            'anthropic-version': ANTHROPIC_VERSION,
            'anthropic-beta': 'mcp-client-2025-04-04'
          },
          body: JSON.stringify(withCaching(anthropicBody))
        })
      : await fetch(engine.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + engine.key },
          body: JSON.stringify(toOpenAIRequest(body, env, engine))
        });
  } catch (err) {
    return { ok: false, retriable: true, reason: 'unreachable', engine: engine,
             response: json({ error: 'could not reach ' + engine.label }, 502, env, request) };
  }

  let detail = upstream.ok ? '' : await upstream.text().catch(() => '');

  /* Caching must never be the reason an answer does not arrive. If the marker
     is ever refused — an account without it, a version that wants it spelled
     differently — the turn is retried once with the body exactly as the page
     sent it, and the only thing lost is the saving. */
  if (!upstream.ok && engine.vendor === 'anthropic' &&
      looksLikeCacheComplaint(upstream.status, detail) && withCaching(anthropicBody) !== anthropicBody) {
    try {
      const plain = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': engine.key,
          'anthropic-version': ANTHROPIC_VERSION,
          'anthropic-beta': 'mcp-client-2025-04-04'
        },
        body: JSON.stringify(anthropicBody)
      });
      upstream = plain;
      detail = upstream.ok ? '' : await upstream.text().catch(() => '');
    } catch (err) {
      return { ok: false, retriable: true, reason: 'unreachable', engine: engine,
               response: json({ error: 'could not reach ' + engine.label }, 502, env, request) };
    }
  }

  if (!upstream.ok && upstream.status === 400 && engine.vendor === 'google' &&
      !googleRejectsReasoningEffort && /INVALID_ARGUMENT/i.test(detail)) {
    googleRejectsReasoningEffort = true;
    try {
      const retry = await fetch(engine.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + engine.key },
        body: JSON.stringify(toOpenAIRequest(body, env, engine))
      });
      upstream = retry;
      detail = upstream.ok ? '' : await upstream.text().catch(() => '');
      /* Only a retry that WORKED proves reasoning_effort was the problem.
         Any other INVALID_ARGUMENT used to switch it off for the life of
         the isolate, and Gemini went back to thinking before every reply. */
      if (!upstream.ok) googleRejectsReasoningEffort = false;
    } catch (err) {
      googleRejectsReasoningEffort = false;
      return { ok: false, retriable: true, reason: 'unreachable', engine: engine,
               response: json({ error: 'could not reach ' + engine.label }, 502, env, request) };
    }
  }

  if (!upstream.ok) {
    if (engine.vendor !== 'anthropic' && !engine.repicked &&
        failureReason(upstream.status, detail) === 'no_such_model') {
      const picked = await pickAvailableModel(engine);
      if (picked && picked !== engine.model) {
        engine.model = picked;
        engine.label = engine.vendor + '/' + picked;
        engine.repicked = true;
        return await callEngine(engine, body, env, request, announce, describedBy, blindWhy);
      }
    }

    const retriable = shouldFailover(upstream.status, detail);
    return {
      ok: false,
      retriable: retriable,
      reason: failureReason(upstream.status, detail),
      engine: engine,
      response: json({
        code: retriable ? 'engine_failed' : 'request_rejected',
        vendor: engine.vendor, model: engine.model, status: upstream.status,
        reason: failureReason(upstream.status, detail),
        error: engine.label + ' returned ' + upstream.status + ': ' + detail.slice(0, 200)
      }, retriable || upstream.status === 401 || upstream.status === 403
           ? 502 : upstream.status, env, request)
    };
  }

  const headers = { ...cors(env, request), 'X-Jarvis-Engine': engine.label };
  if (announce) headers['X-Jarvis-Fallback'] = engine.model;
  /* The reply will talk about an image it never received. Without this the page
     has no way to know that, and the user is left thinking the app is lying. */
  if (imageWillBeDropped(engine, body, env)) {
    headers['X-Jarvis-Blind'] = engine.label;
    if (blindWhy) headers['X-Jarvis-Blind-Why'] = blindWhy;
  }
  if (describedBy) headers['X-Jarvis-Vision'] = describedBy;

  if (engine.vendor === 'anthropic') {
    const contentType = upstream.headers.get('Content-Type') || '';
    if (body.stream && contentType.includes('text/event-stream')) {
      return { ok: true, engine: engine, response: new Response(upstream.body, {
        status: upstream.status,
        headers: { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8',
                   'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive',
                   'X-Accel-Buffering': 'no' }
      })};
    }
    return { ok: true, engine: engine, response: new Response(await upstream.text(), {
      status: upstream.status, headers: { ...headers, 'Content-Type': 'application/json' }
    })};
  }

  if (body.stream) {
    return { ok: true, engine: engine, response: new Response(openAIStreamToAnthropic(upstream.body), {
      status: 200,
      headers: { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8',
                 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' }
    })};
  }
  const data = await upstream.json();
  return { ok: true, engine: engine, response: new Response(JSON.stringify(openAIMessageToAnthropic(data)), {
    status: 200, headers: { ...headers, 'Content-Type': 'application/json' }
  })};
}

const AURA_MODEL = '@cf/deepgram/aura-1';
const MELO_MODEL = '@cf/myshell-ai/melotts';

/* The keyless engine, called from callEngine when the chain reaches it. This
   function was referenced but never actually defined — the reference shipped,
   the body did not — so the last-resort engine would have thrown the moment
   every keyed provider was dry, which is precisely when it is needed.

   Tools are not offered here: these models handle function calling
   inconsistently, and a mangled tool call is worse than a plain answer from
   an engine whose only job is to keep something responding. */
async function callWorkersAI(engine, body, env, request, announce, describedBy, blindWhy) {
  const messages = [];
  { const sys = systemText(body.system); if (sys) messages.push({ role: 'system', content: sys }); }
  for (const m of (body.messages || [])) {
    const text = anthropicBlocksToOpenAI(m.content, false);
    if (text && text.length) messages.push({ role: m.role, content: text });
  }
  try {
    const out = await env.AI.run(engine.model, {
      messages: messages,
      max_tokens: Math.min(body.max_tokens || 2048, 4096)
    });
    const text = (out && (out.response || out.result || '')) || '';
    if (!String(text).trim()) {
      return { ok: false, retriable: true, reason: 'other', engine: engine,
               response: json({ error: engine.label + ' returned nothing' }, 502, env, request) };
    }
    const headers = { ...cors(env, request), 'X-Jarvis-Engine': engine.label };
    if (announce) headers['X-Jarvis-Fallback'] = engine.model;
    if (imageWillBeDropped(engine, body, env)) {
      headers['X-Jarvis-Blind'] = engine.label;
      if (blindWhy) headers['X-Jarvis-Blind-Why'] = blindWhy;
    }
    if (describedBy) headers['X-Jarvis-Vision'] = describedBy;
    const shaped = {
      content: [{ type: 'text', text: stripLeadingThinkingBlock(String(text)) }],
      stop_reason: 'end_turn',
      usage: { output_tokens: 0 }
    };
    /* The client may have asked for a stream. Rather than refuse, hand the
       whole answer back as one well-formed SSE burst so the page's existing
       reader, typewriter and speech queue all behave normally. */
    if (body.stream) {
      const enc = new TextEncoder();
      const ev = (n, d) => enc.encode('event: ' + n + '\ndata: ' + JSON.stringify(d) + '\n\n');
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(ev('message_start', { type:'message_start', message:{ role:'assistant', content:[] } }));
          c.enqueue(ev('content_block_start', { type:'content_block_start', index:0,
                        content_block:{ type:'text', text:'' } }));
          c.enqueue(ev('content_block_delta', { type:'content_block_delta', index:0,
                        delta:{ type:'text_delta', text: shaped.content[0].text } }));
          c.enqueue(ev('content_block_stop', { type:'content_block_stop', index:0 }));
          c.enqueue(ev('message_delta', { type:'message_delta', delta:{ stop_reason:'end_turn' },
                        usage:{ output_tokens:0 } }));
          c.enqueue(ev('message_stop', { type:'message_stop' }));
          c.close();
        }
      });
      return { ok: true, engine: engine, response: new Response(stream, { status: 200,
        headers: { ...headers, 'Content-Type':'text/event-stream; charset=utf-8',
                   'Cache-Control':'no-cache, no-transform', 'X-Accel-Buffering':'no' } }) };
    }
    return { ok: true, engine: engine, response: new Response(JSON.stringify(shaped), {
      status: 200, headers: { ...headers, 'Content-Type': 'application/json' } }) };
  } catch (err) {
    const msg = String((err && err.message) || err);
    return { ok: false, retriable: true,
             reason: /limit|quota|neuron/i.test(msg) ? 'no_credit' : 'other',
             engine: engine,
             response: json({ error: engine.label + ': ' + msg.slice(0, 200) }, 502, env, request) };
  }
}

async function ttsViaCartesia(env, text, voiceId, language) {
  const upstream = await fetch('https://api.cartesia.ai/tts/bytes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cartesia-Version': '2026-03-01',
      'Authorization': 'Bearer ' + env.CARTESIA_API_KEY
    },
    body: JSON.stringify({
      model_id: 'sonic-3.5',
      transcript: text,
      voice: { mode: 'id', id: voiceId || env.CARTESIA_VOICE_ID || DEFAULT_VOICE_ID },
      language: language,
      output_format: { container: 'wav', encoding: 'pcm_s16le', sample_rate: 44100 }
    })
  });
  if (upstream.ok) return { ok: true, body: upstream.body };
  const detail = await upstream.text().catch(() => '');
  return { ok: false, status: upstream.status, detail: detail.slice(0, 200) };
}

async function ttsViaWorkersAI(env, text, language) {
  if (!env.AI) return { ok: false, status: 0, detail: 'Workers AI is not bound' };
  const attempts = language === 'en'
    ? [{ model: env.TTS_MODEL || AURA_MODEL, input: { text: text, speaker: env.TTS_SPEAKER || 'orion', container: 'wav' } },
       { model: MELO_MODEL, input: { prompt: text, lang: 'en' } }]
    : [{ model: MELO_MODEL, input: { prompt: text, lang: language } }];

  let last = 'no attempt ran';
  for (const attempt of attempts) {
    try {
      const result = await env.AI.run(attempt.model, attempt.input, { returnRawResponse: true });
      if (result && typeof result.body !== 'undefined' && typeof result.status === 'number') {
        if (result.ok) return { ok: true, body: result.body };
        last = attempt.model + ' returned ' + result.status;
        continue;
      }
      if (result && typeof result.getReader === 'function') return { ok: true, body: result };
      if (result && result.audio) {
        const bin = atob(result.audio);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return { ok: true, body: bytes };
      }
      last = attempt.model + ' returned an unrecognised shape';
    } catch (err) {
      last = attempt.model + ' threw: ' + String(err).slice(0, 120);
    }
  }
  return { ok: false, status: 0, detail: last };
}

async function handleTts(request, env) {
  const body = await request.json().catch(() => ({}));
  const text = String((body && body.text) || '').slice(0, 3000);
  if (!text.trim()) return json({ error: 'empty text' }, 400, env, request);
  const language = body.language === 'he' ? 'he' : (body.language || 'en');

  const notes = [];

  if (env.CARTESIA_API_KEY) {
    const first = await ttsViaCartesia(env, text, body.voiceId, language);
    if (first.ok) return audioResponse(first.body, env, request, 'cartesia');
    notes.push('cartesia ' + first.status + ': ' + first.detail);
  } else {
    notes.push('cartesia: no key set');
  }

  const second = await ttsViaWorkersAI(env, text, language);
  if (second.ok) return audioResponse(second.body, env, request, 'workers-ai');
  notes.push('workers-ai: ' + second.detail);

  return json({
    error: notes.join(' | '),
    upstream_status: 502,
    voice_exhausted: true
  }, 502, env, request);
}

function audioResponse(body, env, request, via) {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'audio/wav',
      'Cache-Control': 'no-store',
      'X-Jarvis-Voice': via,
      ...cors(env, request)
    }
  });
}

let googleRejectsReasoningEffort = false;

const MESHY_BASE = 'https://api.meshy.ai/openapi/v2/text-to-3d';
/* A photograph is a different job to a sentence, on a different endpoint and a
   different version, and it is a SINGLE pass: the picture already carries the
   colour, so there is no preview-then-paint split to chain. Which of the two a
   task belongs to has to travel in the query string on the way back, exactly
   like `stage` does, because the worker keeps no state and cannot look a task
   id up later to find out what kind it was. */
const MESHY_IMAGE_BASE = 'https://api.meshy.ai/openapi/v1/image-to-3d';

function meshyBaseFor(kind){
  return kind === 'image' ? MESHY_IMAGE_BASE : MESHY_BASE;
}
const MESHY_BALANCE_URL = 'https://api.meshy.ai/openapi/v1/balance';

/* THE KEY, AS MESHY NEEDS IT (2.6.7). It was sent exactly as stored, so a
   key pasted with a trailing space or newline, in quotes, with "Bearer "
   in front, or with its label ("MESHY_API_KEY=msy_...") was refused by
   Meshy as a wrong key — and that reached him only as "a problem with the
   key". Cleaned the way googleClient cleans the Google values, and read
   under the names it is commonly given. The value itself is never shown
   anywhere; only whether it looks right. */
const MESHY_KEY_NAMES = ['MESHY_API_KEY', 'MESHY_KEY', 'MESHY_API_TOKEN', 'MESHY_TOKEN', 'MESHY'];
function meshyKey(env) {
  const name = MESHY_KEY_NAMES.find(n => String(env[n] || '').trim());
  if (!name) return { key: '', name: '', cleaned: false, looksRight: false };
  const raw = String(env[name]);
  let key = raw.trim()
    .replace(/^[A-Za-z_]*(?:MESHY|KEY|TOKEN)[A-Za-z_]*\s*[=:]\s*/i, '')
    .replace(/^['"`]+|['"`]+$/g, '').trim()
    .replace(/^Bearer\s+/i, '').trim();
  const m = /msy_[A-Za-z0-9_-]+/.exec(key);
  if (m) key = m[0];
  key = key.replace(/\s+/g, '');
  return { key, name, cleaned: key !== raw, looksRight: /^msy_[A-Za-z0-9_-]{8,}$/.test(key) };
}

/* What Meshy's refusal means, in words that name the fix. Never a 401 to
   the page: the page reads 401 as its own session having expired and
   would send him back to the PIN screen for Meshy's reason. */
function meshyFailure(status, text, env) {
  const k = meshyKey(env);
  const shape = k.looksRight ? '' :
    ' The key the worker holds' + (k.name ? ' (' + k.name + ')' : '') + ' does not start with msy_, so it is probably not a Meshy API key at all.';
  if (status === 401 || status === 403) {
    return { code: 'meshy_key', http: status,
      error: 'Meshy refused the API key (' + status + ').' + shape +
             ' Make a new key at meshy.ai (Settings, then API), set it on the worker as the secret MESHY_API_KEY, and deploy.',
      tell_the_user: 'Meshy refused the API key, so no model was made. It needs a new Meshy key in the worker.' };
  }
  if (status === 402) {
    return { code: 'meshy_credits', http: status,
      error: 'The Meshy account has no credits left (402). Top it up at meshy.ai; nothing was made or charged.',
      tell_the_user: 'The Meshy account is out of credits, so no model was made.' };
  }
  if (status === 429) {
    return { code: 'meshy_busy', http: status,
      error: 'Meshy is rate-limiting this key (429). Wait a minute and try again.',
      tell_the_user: 'Meshy is busy right now. Try again in a minute.' };
  }
  if (status >= 500) {
    return { code: 'meshy_down', http: status,
      error: 'Meshy itself failed (' + status + '): ' + String(text || '').slice(0, 200),
      tell_the_user: 'The 3D service is having trouble right now.' };
  }
  return { code: 'meshy_error', http: status, error: 'meshy ' + status + ': ' + String(text || '').slice(0, 300) };
}
function model3dNotConfigured() {
  return { code: 'model3d_missing',
    error: '3D generation is not configured: the worker has no 3D key. Make a Tripo key at platform.tripo3d.ai (API Keys), add it to the worker as the secret TRIPO_API_KEY, and deploy. (MESHY_API_KEY from meshy.ai also works, but Meshy needs a paid plan for keys.)',
    fix: 'Cloudflare dashboard, the jarvis worker, Settings, Variables and Secrets: add the secret TRIPO_API_KEY (a key from platform.tripo3d.ai, API Keys; a new account starts with free credits), then Deploy.',
    tell_the_user: 'The 3D service has no key yet, so no model was made.' };
}

/* ---------------------------------------------------------------------
   TRIPO (2.7.0). A new Tripo API account starts with free credits and
   there is no subscription (a textured model from a picture is roughly
   30 credits, 100 credits cost $1), which made it the way to get 3D
   models for someone whose Meshy account cannot make keys. The worker
   picks it whenever a Tripo key is present, and keeps using Meshy when
   only a Meshy key is. The contract the page sees does not change:
   POST /model3d answers { taskId, kind, stage } and /model3d/status
   answers { status, progress, glb, textured }. A Tripo task id travels as
   "tripo:<id>" so the stateless status call knows whose task it is.

   Written from Tripo's published API (Bearer key; POST /upload for a
   picture; POST /task; GET /task/{id}; GET /user/balance). Only the
   parameters that are certain are sent; texture and pbr default to on.
   --------------------------------------------------------------------- */
const TRIPO_BASE = 'https://api.tripo3d.ai/v2/openapi';
const TRIPO_KEY_NAMES = ['TRIPO_API_KEY', 'TRIPO_KEY', 'TRIPO_API_TOKEN', 'TRIPO_TOKEN', 'TRIPO'];
function tripoKey(env) {
  const name = TRIPO_KEY_NAMES.find(n => String(env[n] || '').trim());
  if (!name) return { key: '', name: '', cleaned: false, looksRight: false };
  const raw = String(env[name]);
  let key = raw.trim()
    .replace(/^[A-Za-z_]*(?:TRIPO|KEY|TOKEN)[A-Za-z_]*\s*[=:]\s*/i, '')
    .replace(/^['"`]+|['"`]+$/g, '').trim()
    .replace(/^Bearer\s+/i, '').trim();
  const m = /tsk_[A-Za-z0-9_-]+/.exec(key);
  if (m) key = m[0];
  key = key.replace(/\s+/g, '');
  return { key, name, cleaned: key !== raw, looksRight: /^tsk_[A-Za-z0-9_-]{8,}$/.test(key) };
}

/* Which service makes the models. Tripo when it has a key, else Meshy.
   MODEL3D_PROVIDER=meshy|tripo prefers one when both are set; a preferred
   service with no key of its own is ignored rather than breaking 3D. */
function model3dProvider(env) {
  const t = !!tripoKey(env).key, m = !!meshyKey(env).key;
  const want = String(env.MODEL3D_PROVIDER || '').trim().toLowerCase();
  if (want === 'meshy' && m) return 'meshy';
  if (want === 'tripo' && t) return 'tripo';
  return t ? 'tripo' : m ? 'meshy' : null;
}
function model3dKeyInfo(env) {
  const p = model3dProvider(env);
  if (p === 'tripo') return Object.assign({ provider: 'tripo' }, tripoKey(env));
  if (p === 'meshy') return Object.assign({ provider: 'meshy' }, meshyKey(env));
  return { provider: null, key: '', name: '', cleaned: false, looksRight: false };
}

function tripoFailure(status, text, env) {
  let body = {}; try { body = JSON.parse(text); } catch (e) {}
  const code = body && typeof body.code === 'number' ? body.code : null;
  const msg = String((body && (body.message || body.error)) || text || '').slice(0, 300);
  const k = tripoKey(env);
  const shape = k.looksRight ? '' :
    ' The key the worker holds' + (k.name ? ' (' + k.name + ')' : '') + ' does not start with tsk_, so it is probably not a Tripo API key.';
  const keyFix = 'Cloudflare dashboard, the jarvis worker, Settings, Variables and Secrets: set TRIPO_API_KEY to a key made at platform.tripo3d.ai (API Keys), then Deploy. check_3d_service then says whether Tripo accepts it.';
  if (code === 2010 || /credit/i.test(msg)) {
    return { code: 'tripo_credits', http: status,
      error: 'The Tripo account has no credits left (' + status + '): ' + msg + ' Top up at platform.tripo3d.ai; nothing was made.',
      fix: 'Top up credits at platform.tripo3d.ai (100 credits cost $1).',
      tell_the_user: 'The Tripo account is out of credits, so no model was made.' };
  }
  if (status === 401 || status === 403 || /api ?key|unauthori[sz]ed|authenticat|invalid (?:token|key)/i.test(msg)) {
    return { code: 'tripo_key', http: status,
      error: 'Tripo refused the API key (' + status + '): ' + msg + '.' + shape + ' Make a key at platform.tripo3d.ai (API Keys), set it on the worker as the secret TRIPO_API_KEY, and deploy.',
      fix: keyFix,
      tell_the_user: 'Tripo refused the API key, so no model was made. It needs a new Tripo key in the worker.' };
  }
  if (code === 2008 || /content|policy|sensitive|violat/i.test(msg)) {
    return { code: 'tripo_content', http: status,
      error: 'Tripo would not make a model from that picture (content policy): ' + msg,
      tell_the_user: 'Tripo refused that picture, so no model was made.' };
  }
  if (status === 429 || code === 2000 || /rate|too many|exceeded the limit/i.test(msg)) {
    return { code: 'tripo_busy', http: status,
      error: 'Tripo is limiting this key (' + status + '): ' + msg + ' Wait a minute and try again.',
      tell_the_user: 'Tripo is busy right now. Try again in a minute.' };
  }
  if (status >= 500) {
    return { code: 'tripo_down', http: status,
      error: 'Tripo itself failed (' + status + '): ' + msg,
      tell_the_user: 'The 3D service is having trouble right now.' };
  }
  return { code: 'tripo_error', http: status, error: 'tripo ' + status + (code != null ? ' (' + code + ')' : '') + ': ' + msg };
}

function tripoFetch(path, env, opt) {
  opt = opt || {};
  return fetch(TRIPO_BASE + path, Object.assign({}, opt, {
    headers: Object.assign({ 'Authorization': 'Bearer ' + tripoKey(env).key }, opt.headers || {})
  }));
}

/* Tripo answers { code, data } and reports most problems inside that body,
   so a 200 with a non-zero code is a failure too. */
async function tripoRead(res, env) {
  const text = await res.text();
  let body = {}; try { body = JSON.parse(text); } catch (e) {}
  if (!res.ok || (typeof body.code === 'number' && body.code !== 0)) {
    return { failure: tripoFailure(res.ok ? 400 : res.status, text, env) };
  }
  return { body, data: (body && body.data) || {} };
}

function dataUriBytes(uri) {
  const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(uri);
  if (!m) return null;
  let bin;
  try { bin = atob(m[2].replace(/\s+/g, '')); } catch (e) { return null; }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const t = m[1].toLowerCase();
  const ext = (t === 'jpeg' || t === 'jpg') ? 'jpg' : t;
  return { bytes, ext, mime: 'image/' + (ext === 'jpg' ? 'jpeg' : ext) };
}

async function startTripo(image, prompt, env) {
  let payload;
  if (image) {
    const pic = dataUriBytes(image);
    if (!pic) return { failure: { code: 'tripo_error', error: 'that picture could not be read' } };
    const fd = new FormData();
    fd.append('file', new Blob([pic.bytes], { type: pic.mime }), 'picture.' + pic.ext);
    const up = await tripoFetch('/upload', env, { method: 'POST', body: fd });
    const u = await tripoRead(up, env);
    if (u.failure) return u;
    const token = u.data.image_token || u.data.file_token;
    if (!token) return { failure: { code: 'tripo_error', error: 'Tripo did not take the picture (no upload token): ' + JSON.stringify(u.body).slice(0, 200) } };
    payload = { type: 'image_to_model', file: { type: pic.ext, file_token: token } };
  } else {
    payload = { type: 'text_to_model', prompt };
  }
  const res = await tripoFetch('/task', env, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const t = await tripoRead(res, env);
  if (t.failure) return t;
  const id = t.data.task_id;
  if (!id) return { failure: { code: 'tripo_error', error: 'Tripo did not return a task id: ' + JSON.stringify(t.body).slice(0, 200) } };
  return { taskId: 'tripo:' + id };
}

function tripoUrl(v) {
  return typeof v === 'string' && v ? v : (v && typeof v.url === 'string' && v.url ? v.url : null);
}

async function handleTripoStatus(id, env, request) {
  const res = await tripoFetch('/task/' + encodeURIComponent(id), env);
  const r = await tripoRead(res, env);
  if (r.failure) return json(r.failure, 502, env, request);
  const d = r.data;
  const status = String(d.status || '').toLowerCase();
  const progress = Math.max(0, Math.min(100, typeof d.progress === 'number' ? Math.round(d.progress) : 0));
  if (status === 'queued' || status === 'running' || status === '') {
    return json({ status: status === 'queued' ? 'PENDING' : 'IN_PROGRESS', stage: 'single', progress, glb: null, error: null }, 200, env, request);
  }
  if (status === 'success') {
    const out = d.output || {}, result = d.result || {};
    const textured = tripoUrl(out.pbr_model) || tripoUrl(result.pbr_model) || tripoUrl(out.model) || tripoUrl(result.model);
    const bare = tripoUrl(out.base_model) || tripoUrl(result.base_model);
    const glb = textured || bare;
    if (!glb) {
      return json({ status: 'FAILED', stage: 'single', progress, glb: null,
        error: 'Tripo finished but returned no model file' }, 200, env, request);
    }
    return json({
      status: 'SUCCEEDED', stage: 'single', progress: 100, glb,
      textured: !!textured,
      note: textured ? undefined : 'Tripo returned the untextured mesh',
      thumbnail: tripoUrl(out.rendered_image) || tripoUrl(result.rendered_image),
      credits_used: typeof d.consumed_credit === 'number' ? d.consumed_credit : null,
      error: null
    }, 200, env, request);
  }
  const why = status === 'banned' ? 'Tripo refused it (content policy)'
            : status === 'expired' ? 'the Tripo task expired'
            : status === 'cancelled' ? 'the Tripo task was cancelled'
            : 'Tripo could not make a model from that (' + (status || 'failed') + ')';
  return json({ status: 'FAILED', stage: 'single', progress, glb: null, error: why }, 200, env, request);
}

/* Meshy's text-to-3D is two jobs, not one. `preview` produces the mesh: the
   right shape, but bare geometry with no surface on it. `refine` takes that
   finished preview and paints it — base colour, and with enable_pbr the
   metalness, roughness and normal maps that make a render look like a
   photograph rather than a clay study.
   Only the first half was ever run here, which is why generated models arrived
   looking like grey sculpture. The second half costs another credit and about
   another minute, and it is the whole difference.
   Chaining is done here rather than in the page because the page must not hold
   a Meshy task id's meaning: it polls one endpoint and is told what to poll
   next. The worker stays stateless — the stage travels in the query string. */
async function startMeshyTask(payload, env, kind) {
  const res = await fetch(meshyBaseFor(kind), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + meshyKey(env).key
    },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  if (!res.ok) return meshyFailure(res.status, text, env);
  let data; try { data = JSON.parse(text); } catch (err) { data = {}; }
  const taskId = data.result || data.id;
  if (!taskId) return { error: 'meshy did not return a task id: ' + text.slice(0, 200) };
  return { taskId: taskId };
}

async function handleModel3d(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405, env, request);
  const provider = model3dProvider(env);
  if (!provider) return json(model3dNotConfigured(), 503, env, request);
  const body = await request.json().catch(() => ({}));

  /* A picture, if one came, as a data URI, which is what the page already
     holds for every attachment and every camera frame. */
  const image = String((body && body.image) || '').trim();
  if (image) {
    if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(image)) {
      return json({ error: 'the image must be a png, jpeg or webp data URI' }, 400, env, request);
    }
    /* A request this size is worth refusing early with a readable reason
       rather than as a 413 from somewhere downstream. */
    if (image.length > 12 * 1024 * 1024) {
      return json({ error: 'that image is too large; send one under about 8MB' }, 413, env, request);
    }
  }

  if (provider === 'tripo') {
    const tripoPrompt = String((body && body.prompt) || '').trim().slice(0, 600);
    if (!image && !tripoPrompt) return json({ error: 'no prompt and no image' }, 400, env, request);
    /* The picture carries the colour, so the texture prompt and symmetry
       hints Meshy takes are not sent: nothing here is guessed at. */
    const t = await startTripo(image, tripoPrompt, env);
    if (t.failure) return json(t.failure, 502, env, request);
    return json({ taskId: t.taskId, kind: image ? 'image' : 'text', stage: image ? 'single' : 'preview', provider: 'tripo' }, 200, env, request);
  }

  if (image) {
    /* What JARVIS worked out by studying the picture from every side (page
       2.9.3): the materials and colours steer the texture pass, and the
       symmetry tells Meshy to mirror what it can see onto the side it
       cannot. Both optional, so an older page sends exactly what it did. */
    const meshyImage = {
      image_url: image,
      enable_pbr: true,
      should_remesh: true,
      should_texture: true
    };
    const texturePrompt = String((body && body.texture_prompt) || '').replace(/\s+/g, ' ').trim().slice(0, 800);
    if (texturePrompt) meshyImage.texture_prompt = texturePrompt;
    const symmetry = String((body && body.symmetry_mode) || '').trim();
    if (symmetry === 'on' || symmetry === 'off' || symmetry === 'auto') meshyImage.symmetry_mode = symmetry;
    const startedImg = await startMeshyTask(meshyImage, env, 'image');
    if (startedImg.error) return json(startedImg, 502, env, request);
    return json({ taskId: startedImg.taskId, kind: 'image', stage: 'single' }, 200, env, request);
  }

  const prompt = String((body && body.prompt) || '').trim().slice(0, 600);
  if (!prompt) return json({ error: 'no prompt and no image' }, 400, env, request);

  const started = await startMeshyTask({
    mode: 'preview',
    prompt: prompt,
    art_style: body.style === 'sculpture' ? 'sculpture' : 'realistic',
    should_remesh: true
  }, env);
  if (started.error) return json(started, 502, env, request);

  return json({ taskId: started.taskId, kind: 'text', stage: 'preview' }, 200, env, request);
}

async function readMeshyTask(id, env, kind) {
  const res = await fetch(meshyBaseFor(kind) + '/' + encodeURIComponent(id), {
    headers: { 'Authorization': 'Bearer ' + meshyKey(env).key }
  });
  const text = await res.text();
  if (!res.ok) { const f = meshyFailure(res.status, text, env); return { httpError: f.error, failure: f }; }
  let data; try { data = JSON.parse(text); } catch (err) { data = {}; }
  return { data: data };
}

/* "Is my Meshy key all right?" answered by Meshy itself, without making
   anything: the balance endpoint costs nothing and needs the same key. */
async function handleModel3dCheck(request, env) {
  const k = model3dKeyInfo(env);
  const about = { provider: k.provider, provider_label: k.provider === 'tripo' ? 'Tripo' : k.provider === 'meshy' ? 'Meshy' : null,
                  key_name: k.name || null, key_looks_right: k.looksRight, key_was_cleaned: k.cleaned };
  if (!k.key) return json(Object.assign({ ok: false }, model3dNotConfigured(), about), 200, env, request);
  if (k.provider === 'tripo') {
    let res;
    try {
      res = await tripoFetch('/user/balance', env);
    } catch (err) {
      return json(Object.assign({ ok: false, code: 'tripo_unreachable',
        error: 'Tripo could not be reached from the worker: ' + ((err && err.message) || err),
        tell_the_user: 'The 3D service could not be reached just now.' }, about), 200, env, request);
    }
    const r = await tripoRead(res, env);
    if (r.failure) return json(Object.assign({ ok: false }, r.failure, about), 200, env, request);
    const balance = typeof r.data.balance === 'number' ? r.data.balance : null;
    return json(Object.assign({ ok: true, balance,
      note: balance === 0 ? 'The key works, but the account has no credits: every model will fail until it is topped up.' : null
    }, about), 200, env, request);
  }
  let res, text;
  try {
    res = await fetch(MESHY_BALANCE_URL, { headers: { 'Authorization': 'Bearer ' + k.key } });
    text = await res.text();
  } catch (err) {
    return json(Object.assign({ ok: false, code: 'meshy_unreachable',
      error: 'Meshy could not be reached from the worker: ' + ((err && err.message) || err),
      tell_the_user: 'The 3D service could not be reached just now.' }, about), 200, env, request);
  }
  if (!res.ok) return json(Object.assign({ ok: false }, meshyFailure(res.status, text, env), about), 200, env, request);
  let data = {}; try { data = JSON.parse(text); } catch (e) {}
  const balance = typeof data.balance === 'number' ? data.balance
                : typeof data.credits === 'number' ? data.credits : null;
  return json(Object.assign({ ok: true, balance,
    note: balance === 0 ? 'The key works, but the account has no credits: every model will fail with 402 until it is topped up.' : null
  }, about), 200, env, request);
}

async function handleModel3dStatus(request, env) {
  const params = new URL(request.url).searchParams;
  const id = params.get('id');
  /* Whose task it is travels in its id ("tripo:..."), so a job already
     running finishes on its own service even if the key set changes. */
  if (id && id.indexOf('tripo:') === 0) {
    if (!tripoKey(env).key) return json(model3dNotConfigured(), 503, env, request);
    return await handleTripoStatus(id.slice(6), env, request);
  }
  if (!meshyKey(env).key) return json(model3dNotConfigured(), 503, env, request);
  if (!id) return json({ error: 'missing id' }, 400, env, request);

  const kind = params.get('kind') === 'image' ? 'image' : 'text';
  const stage = params.get('stage') === 'refine' ? 'refine' : 'preview';
  /* From a photograph there is only one pass, so there is nothing to chain
     and the progress bar is the raw one. */
  const wantsTexture = kind === 'image' ? false : params.get('refine') !== '0';

  const read = await readMeshyTask(id, env, kind);
  if (read.httpError) return json(read.failure || { error: read.httpError }, 502, env, request);
  const data = read.data;

  const status = String(data.status || '').toUpperCase();
  const urls = data.model_urls || {};
  const raw = typeof data.progress === 'number' ? data.progress : 0;

  /* Two jobs run back to back, so raw progress would count 0-100 twice. Each
     stage owns half the bar, and it only ever moves forwards. */
  const progress = (stage === 'refine' || !wantsTexture)
    ? (wantsTexture ? 50 + Math.round(raw / 2) : raw)
    : Math.round(raw / 2);

  if (status === 'FAILED') {
    return json({
      status: 'FAILED', stage: stage, progress: progress, glb: null,
      error: (data.task_error && data.task_error.message) || 'generation failed'
    }, 200, env, request);
  }

  if (status !== 'SUCCEEDED') {
    return json({ status: status, stage: stage, progress: progress, glb: null, error: null }, 200, env, request);
  }

  // The untextured mesh, either as the answer or as the thing to paint next.
  const previewGlb = urls.glb || null;

  if (stage === 'preview' && wantsTexture) {
    /* enable_pbr is what buys the metal/roughness maps rather than a flat
       colour. If this build of the API will not take it, texturing still
       matters far more than PBR does — so try again plainly before giving up,
       and if even that fails hand back the mesh we already paid for rather
       than losing the whole job to an optional flag. */
    let refine = await startMeshyTask({ mode: 'refine', preview_task_id: id, enable_pbr: true }, env);
    if (refine.error) refine = await startMeshyTask({ mode: 'refine', preview_task_id: id }, env);
    if (refine.error) {
      return json({
        status: 'SUCCEEDED', stage: 'preview', progress: 100,
        glb: previewGlb, textured: false,
        thumbnail: data.thumbnail_url || null,
        note: 'texturing could not be started (' + refine.error + '); this is the untextured mesh',
        error: null
      }, 200, env, request);
    }
    return json({
      status: 'TEXTURING', stage: 'refine', taskId: refine.taskId,
      progress: 50, glb: null, previewGlb: previewGlb,
      thumbnail: data.thumbnail_url || null, error: null
    }, 200, env, request);
  }

  return json({
    status: 'SUCCEEDED', stage: stage, progress: 100,
    glb: previewGlb,
    /* A model from a photograph is textured by construction \u2014 the picture is
       where the colour came from \u2014 so it must not be reported as a bare mesh
       just because it never went through a refine stage. */
    textured: kind === 'image' ? true : stage === 'refine',
    thumbnail: data.thumbnail_url || null, error: null
  }, 200, env, request);
}

const XAI_FALLBACK_URL     = 'https://api.x.ai/v1/chat/completions';
const DEFAULT_FALLBACK_URL = XAI_FALLBACK_URL;
const OPENAI_FALLBACK_URL  = 'https://api.openai.com/v1/chat/completions';
const GOOGLE_FALLBACK_URL  = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

const GROQ_FALLBACK_URL       = 'https://api.groq.com/openai/v1/chat/completions';
const OPENROUTER_FALLBACK_URL = 'https://openrouter.ai/api/v1/chat/completions';
const CEREBRAS_FALLBACK_URL   = 'https://api.cerebras.ai/v1/chat/completions';

const OPENAI_VENDOR = { vendor: 'openai', url: OPENAI_FALLBACK_URL, model: 'gpt-5.2' };
const FALLBACK_VENDORS = [
  { test: /^(AIza|AQ\.)/, vendor: 'google',  url: GOOGLE_FALLBACK_URL,     model: 'gemini-3.6-flash' },
  { test: /^gsk_/,     vendor: 'groq',       url: GROQ_FALLBACK_URL,       model: 'llama-3.3-70b-versatile' },
  { test: /^sk-or-/i,  vendor: 'openrouter', url: OPENROUTER_FALLBACK_URL, model: 'openai/gpt-oss-20b:free' },
  { test: /^csk-/i,    vendor: 'cerebras',   url: CEREBRAS_FALLBACK_URL,   model: 'gpt-oss-120b' },
  { test: /^xai-/i,    vendor: 'xai',        url: XAI_FALLBACK_URL,        model: 'grok-4.5' },
  { test: /^sk-/i,     ...OPENAI_VENDOR }
];

function openAIEngine(key, model, url, slot, modelVar) {
  key = String(key || '').trim();
  if (!key) return null;
  const v = FALLBACK_VENDORS.find(x => x.test.test(key)) || OPENAI_VENDOR;
  const engine = {
    key: key,
    slot: slot,
    modelVar: modelVar || (slot + '_MODEL'),
    vendor: v.vendor,
    url: url || v.url,
    model: model || v.model,
    label: ''
  };
  engine.label = engine.vendor + '/' + engine.model;
  return engine;
}

function engineChain(env) {
  const chain = [];
  const primary = openAIEngine(env.PRIMARY_API_KEY, env.PRIMARY_MODEL, env.PRIMARY_API_URL,
                               'PRIMARY', 'PRIMARY_MODEL');
  if (primary) chain.push(primary);
  if (env.ANTHROPIC_API_KEY) {
    chain.push({ vendor: 'anthropic', key: env.ANTHROPIC_API_KEY, slot: 'ANTHROPIC',
                 model: 'claude', label: 'anthropic/claude' });
  }
  for (const n of ['', '_2', '_3']) {
    const e = openAIEngine(env['FALLBACK_API_KEY' + n], env['FALLBACK_MODEL' + n],
                           env['FALLBACK_API_URL' + n], 'FALLBACK' + n, 'FALLBACK_MODEL' + n);
    if (e) chain.push(e);
  }
  /* Last in the chain, and the only engine here that needs no key of its own:
     it runs on the Workers AI binding this worker already has for images and
     transcription. Cloudflare's free plan allows 10,000 Neurons a day, which
     is roughly 15-25 replies — nowhere near enough to be the main brain, and
     it is deliberately last for that reason. What it buys is that the app is
     never completely dead: when every keyed provider is dry or misconfigured
     at once, something still answers instead of "all engines down". */
  if (env.AI) {
    chain.push({
      vendor: 'workers-ai', key: '', slot: 'WORKERS_AI',
      model: env.WORKERS_AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      label: 'workers-ai/' + (env.WORKERS_AI_MODEL || 'llama-3.3-70b')
    });
  }
  return chain;
}

function fallbackProvider(env) {
  return openAIEngine(env.FALLBACK_API_KEY, env.FALLBACK_MODEL, env.FALLBACK_API_URL,
                      'FALLBACK', 'FALLBACK_MODEL');
}

const cooldowns = new Map();
const PRIMARY_COOLDOWN_MS = 5 * 60 * 1000;

function cooling(engine)      { return Date.now() < (cooldowns.get(engine.label) || 0); }
function setCooldown(engine)  { cooldowns.set(engine.label, Date.now() + PRIMARY_COOLDOWN_MS); }
function clearCooldown(engine){ cooldowns.delete(engine.label); }

function failureReason(status, detail) {
  const text = String(detail || '');
  if (status === 401 || status === 403) return 'key_rejected';
  if (/quota|billing|credit|insufficient|exceeded your current/i.test(text)) return 'no_credit';
  if (status === 429) return 'rate_limited';
  if (/model/i.test(text) && (status === 404 || status === 400)) return 'no_such_model';
  if (status >= 500) return 'provider_down';
  return 'other';
}

export const __test = {
  resetCooldown() { cooldowns.clear(); },
  cooldownActive(label) {
    if (label) return Date.now() < (cooldowns.get(label) || 0);
    return cooldowns.size > 0;
  },
  chain(env) { return engineChain(env).map(e => e.label); },
  normalizePhone(p) { return normalizePhone(p); },
  parseSendAt(v, tz) { return parseSendAt(v, tz); },
  runOutbox(env) { return runOutbox(env); },
  readCallReply(status, body) { return readCallReply(status, body); },
  callTarget(env) { return callTarget(env); },
  resetSchema() { schemaReady = null; agentSchemaReady = null; },
  // AGENTS — the registry and the pieces built on it, exposed for testing.
  get AGENT_REGISTRY() { return AGENT_REGISTRY; },
  agentHasPermission(agentId, cap) { return agentHasPermission(agentId, cap); },
  checkToolPermission(agentId, tool, input) { return checkToolPermission(agentId, tool, input); },
  requiresApproval(cap) { return requiresApproval(cap); },
  logEvent(env, e) { return logEvent(env, e); },
  searchCore(q) { return searchCore(q); },
  fetchPageCore(u) { return fetchPageCore(u); },
  shopifyGraphQL(target, q, v) { return shopifyGraphQL(target, q, v); },
  getBrandProfile(env) { return getBrandProfile(env); },
  agentIsPaused(env, id) { return agentIsPaused(env, id); },
  dueAgents(env, now) { return dueAgents(env, now); },
  runScheduledAgent(env, id) { return runScheduledAgent(env, id); },
  runAgentInWorker(env, agentId, text) { return runAgentInWorker(env, agentId, text); },
  runDueAgents(env) { return runDueAgents(env); },
  maybeSendDailySummary(env, now) { return maybeSendDailySummary(env, now); },
  pickChainForAgent(env, id) { return pickChainForAgent(env, id); },
  getAgentConfig(env, id) { return getAgentConfig(env, id); },
  setAgentConfig(env, id, patch) { return setAgentConfig(env, id, patch); },
  dailyIsDue(schedule, lastRunAt, now) { return dailyIsDue(schedule, lastRunAt, now); },
  qaCheckPage(u) { return qaCheckPage(u); },
  openAIStreamToAnthropic(b) { return openAIStreamToAnthropic(b); }
};

function shouldFailover(status, bodyText) {
  const text = String(bodyText || '');
  if (status === 402 || status === 429) return true;
  if (status >= 500) return true;
  if (status === 401 || status === 403) return true;
  if (status === 404) return true;
  if (status === 413) return true;
  if ((status === 400 || status === 422) &&
      /model|not found|does not exist|decommissioned|deprecated/i.test(text)) return true;
  if (status === 400 &&
      /credit balance|insufficient|quota|billing/i.test(text)) return true;
  return false;
}

function anthropicBlocksToOpenAI(content, allowImages) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  if (!allowImages) {
    const pieces = [];
    for (const block of content) {
      if (block.type === 'text') pieces.push(block.text);
      else if (block.type === 'image') pieces.push(
        '[An image was attached here by the user, but it could not be delivered to you: ' +
        'the engine answering this request has no vision, so the picture was stripped out on the way. ' +
        'Say plainly that the image did not reach you and that this is a backend limitation — ' +
        'do NOT claim you are unable to look at images as a general matter, and do not pretend ' +
        'the user failed to send one. Asking them to describe it is a reasonable fallback, ' +
        'but only after saying why.]');
      else if (block.type === 'document') pieces.push('[the user attached a document, which this model cannot read]');
    }
    return pieces.join('\n').trim();
  }

  const parts = [];
  for (const block of content) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text });
    } else if (block.type === 'image' && block.source && block.source.data) {
      parts.push({
        type: 'image_url',
        image_url: { url: 'data:' + (block.source.media_type || 'image/jpeg') +
                          ';base64,' + block.source.data }
      });
    }
  }
  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text;
  return parts.length ? parts : '';
}

/* Whether a model can look at a picture is a property of the MODEL, not of the
   company that sells it. This used to whitelist exactly one vendor — google —
   so GPT-4o, Grok, Pixtral, Llama 4 and every vision model on OpenRouter were
   all declared blind, their images replaced by a line of text, and the model
   then told the user it could not see images. It was right: by the time it read
   the request, there was no image in it. */
const VISION_MODELS = [
  /gpt-4o/i, /gpt-4\.1/i, /gpt-4-turbo/i, /gpt-4\.5/i, /gpt-5/i, /chatgpt-4o/i,
  /(^|[\/-])o[134]([-.]|$)/i,
  /gemini/i, /grok-[2-9]/i, /grok.*vision/i,
  /llama-?4/i, /scout/i, /maverick/i, /llama-3\.2-(11|90)b/i, /llama.*vision/i,
  /pixtral/i, /qwen.*-?vl/i, /internvl/i, /molmo/i, /claude/i, /mistral-(small|medium)-3/i
];

function engineSeesImages(provider, env) {
  const vendor = (provider && provider.vendor) || '';
  const model  = String((provider && provider.model) || '');

  /* callWorkersAI sends text only, whatever the model could do, so a
     Llama 4 there was counted as seeing while its picture was dropped
     without a word — and nothing described it first. */
  if (vendor === 'workers-ai') return false;

  /* The manual override, and the only thing that does not go stale as models
     ship. Takes a vendor ("xai") or a piece of a model name ("qwen2.5-vl"). */
  const extra = String((env && env.VISION_ENGINES) || '')
    .split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (extra.some(x => vendor === x || model.toLowerCase().indexOf(x) >= 0)) return true;

  if (vendor === 'anthropic') return true;     // every Claude sees
  if (vendor === 'google')    return true;     // every Gemini sees
  return VISION_MODELS.some(re => re.test(model));
}

/* WHEN NOTHING IN THE CHAIN CAN SEE.

   Until now a picture sent to a text-only engine was simply removed, and
   the assistant then explained that it could not see images. That was
   honest and completely useless: the picture existed, the user was
   looking at it, and the one thing standing between them was that the
   model answering happened to be text-only.

   Workers AI has vision models, and the binding is already here for
   speech. So the picture is DESCRIBED first, by a model that can see,
   and the description goes to the text model in its place. It is not as
   good as a model looking at the pixels itself — and it never claims to
   be: the replacement block says out loud that it is a description, and
   tells the model to say so rather than guess if what it needs is not in
   there.

   Costs one extra Workers AI call per picture and needs no new key.

   Which describer matters (2.6.5). The first two used to be Llama 3.2
   Vision — which answers every account with error 5016 until someone sends
   it the word "agree" once, accepting Meta's licence — and LLaVA 1.5, sent
   the picture as a JSON array of numbers: one number per byte, so a screen
   capture became millions of them. Both failed, nothing was described, and
   every picture from the screen reached a text-only engine as "a backend
   limitation". Llama 4 Scout and Gemma 3 take the picture the ordinary
   way, as a data URL inside the chat message, with no licence step, so
   they go first; the old two stay behind them for accounts where they
   work. VISION_DESCRIBER (optional) puts a model of your choice first. */
const VISION_DESCRIBERS = [
  { model: '@cf/meta/llama-4-scout-17b-16e-instruct', input: 'chat' },
  { model: '@cf/google/gemma-3-12b-it',               input: 'chat' },
  { model: '@cf/meta/llama-3.2-11b-vision-instruct',  input: 'bytes' },
  { model: '@cf/llava-hf/llava-1.5-7b-hf',            input: 'bytes' }
];

function describersFor(env) {
  const pinned = String((env && env.VISION_DESCRIBER) || '').trim();
  if (!pinned) return VISION_DESCRIBERS;
  const known = VISION_DESCRIBERS.find(d => d.model === pinned);
  const first = known || { model: pinned, input: /llava|uform|llama-3\.2-11b-vision/i.test(pinned) ? 'bytes' : 'chat' };
  return [first].concat(VISION_DESCRIBERS.filter(d => d.model !== pinned));
}

const DESCRIBE_PROMPT =
  'Describe this image for someone who cannot see it. Name what is in it, ' +
  'read out any text exactly as it appears, and give colours, materials, ' +
  'quantities and anything else specific. Be factual and concrete. Do not ' +
  'speculate about what is not visible.';

/* At most this many pictures per request get described. A turn carrying
   more is a gallery, not a question, and describing all of them would cost
   more time than the answer is worth. */
const DESCRIBE_MAX = 3;

function base64ToBytes(b64) {
  const bin = atob(String(b64 || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* What the person asked alongside the picture — "what does this error say"
   while he watches his screen. The describer is told, so the one thing he
   asked about is in the description, and read out in full, rather than
   left out of a general summary of a crowded screen. */
function questionBeside(message) {
  if (!message || !Array.isArray(message.content)) return '';
  return message.content
    .filter(b => b && b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text.trim())
    .filter(t => t && !/^\[/.test(t))
    .join(' ').replace(/\s+/g, ' ').slice(0, 400);
}

function describeReplyText(out) {
  if (!out) return '';
  if (typeof out === 'string') return out;
  const c = out.choices && out.choices[0] && out.choices[0].message && out.choices[0].message.content;
  const r = out.description || out.response || out.result || c || '';
  return typeof r === 'string' ? r : '';
}

/* One short, header-safe reason per failed describer. */
function describeFailure(model, err) {
  const short = String(model).replace(/^@cf\/[^/]+\//, '');
  const msg = String((err && (err.message || err)) || 'no answer');
  const why = /5016|agree/i.test(msg)
    ? 'needs the one-time "agree" to Meta\'s licence'
    : msg.replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim().slice(0, 110);
  return short + ': ' + (why || 'failed');
}

function describeFailureSummary(failures) {
  if (!failures || !failures.length) return null;
  const seen = [];
  for (const f of failures) if (seen.indexOf(f) < 0) seen.push(f);
  return ('no vision model could describe it - ' + seen.join('; ')).slice(0, 400);
}

async function describeOneImage(block, env, question, failures) {
  const data = String((block.source && block.source.data) || '');
  const mediaType = (block.source && block.source.media_type) || 'image/jpeg';
  let bytes = null;
  const byteArray = () => {
    if (!bytes) bytes = [...base64ToBytes(data)];
    return bytes;
  };
  try {
    if (!base64ToBytes(data.slice(0, 64)).length) return null;
  } catch (e) { return null; }
  const prompt = DESCRIBE_PROMPT + (question
    ? ' The person who sent it asked: "' + question + '". Make sure everything that question needs is in ' +
      'the description, with any text it is about copied out word for word.'
    : '');
  for (const d of describersFor(env)) {
    try {
      const out = d.input === 'chat'
        ? await env.AI.run(d.model, {
            messages: [{ role: 'user', content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: 'data:' + mediaType + ';base64,' + data } }
            ] }],
            max_tokens: 800
          })
        : await env.AI.run(d.model, { image: byteArray(), prompt: prompt, max_tokens: 512 });
      const text = String(describeReplyText(out)).trim();
      if (text) return { text: text, model: d.model };
      if (failures) failures.push(describeFailure(d.model, 'answered with no text'));
    } catch (err) {
      if (failures) failures.push(describeFailure(d.model, err));
    }
  }
  return null;
}

/* Replaces image blocks in place. Returns the model that did the work, or
   null if nothing could be described — in which case the old behaviour
   stands and the picture is stripped further down, as before, and
   `failures` says why. */
async function describeImagesInBody(body, env, failures) {
  if (!env || !env.AI) {
    if (failures) failures.push('the worker has no AI binding, so nothing could describe it');
    return null;
  }
  let used = null, done = 0;
  for (const message of (body.messages || [])) {
    if (!Array.isArray(message.content)) continue;
    const question = questionBeside(message);
    for (let i = 0; i < message.content.length; i++) {
      const block = message.content[i];
      if (!block || block.type !== 'image') continue;
      if (done >= DESCRIBE_MAX) continue;
      const got = await describeOneImage(block, env, question, failures);
      if (!got) continue;
      done++;
      used = got.model;
      message.content[i] = {
        type: 'text',
        text: '[A picture he sent. The model answering this request cannot see ' +
              'pictures, so it was described by a vision model first. This is the ' +
              'description, not the picture:\n\n' + got.text +
              '\n\nAnswer from this description. If what he is asking about is not ' +
              'in it, say that you are working from a description and ask him ' +
              'what you need — do not invent a detail that is not written above.]'
      };
    }
  }
  return used;
}

/* A picture INSIDE a tool result (take_screenshot, the camera's look)
   reaches Claude as a picture — and every other engine as a JSON string of
   base64, because a tool message in the OpenAI shape holds text only. So a
   screenshot taken while Claude was out of credit arrived as megabytes of
   noise: no picture, and nothing any describer could reach. Lifted out to
   sit straight after the results, where an engine that can see gets it as a
   picture and one that cannot gets it described. Claude takes both shapes. */
function liftToolResultImages(body) {
  for (const message of ((body && body.messages) || [])) {
    if (!Array.isArray(message.content)) continue;
    const lifted = [];
    for (const block of message.content) {
      if (!block || block.type !== 'tool_result' || !Array.isArray(block.content)) continue;
      if (!block.content.some(b => b && b.type === 'image')) continue;
      const keep = block.content.filter(b => !(b && b.type === 'image'));
      for (const b of block.content) if (b && b.type === 'image') lifted.push(b);
      keep.push({ type: 'text', text: '[The picture this returned comes right after the results.]' });
      block.content = keep;
    }
    if (lifted.length) {
      const results = message.content.filter(b => b && b.type === 'tool_result');
      const rest = message.content.filter(b => !(b && b.type === 'tool_result'));
      message.content = results.concat(lifted, rest);
    }
  }
  return body;
}

/* Did this request carry a picture that this engine will not be shown? */
function imageWillBeDropped(engine, body, env) {
  if (!engine || engine.vendor === 'anthropic') return false;
  if (engineSeesImages(engine, env)) return false;
  return (body && body.messages || []).some(m =>
    Array.isArray(m.content) && m.content.some(b => b && b.type === 'image'));
}

function toOpenAIRequest(body, env, provider) {
  provider = provider || fallbackProvider(env);
  const allowImages = engineSeesImages(provider, env);
  const messages = [];
  { const sys = systemText(body.system); if (sys) messages.push({ role: 'system', content: sys }); }

  for (const message of (body.messages || [])) {
    const content = message.content;

    if (Array.isArray(content)) {
      const toolResults = content.filter(b => b && b.type === 'tool_result');
      const toolUses = content.filter(b => b && b.type === 'tool_use');

      if (toolResults.length) {
        for (const result of toolResults) {
          messages.push({
            role: 'tool',
            tool_call_id: result.tool_use_id,
            content: typeof result.content === 'string' ? result.content
              : (Array.isArray(result.content) && result.content.every(b => b && b.type === 'text'))
                ? result.content.map(b => b.text).join('\n')
                : JSON.stringify(result.content)
          });
        }
        const leftover = content.filter(b => b && b.type !== 'tool_result');
        if (leftover.length) {
          const converted = anthropicBlocksToOpenAI(leftover, allowImages);
          if (converted && converted.length) messages.push({ role: 'user', content: converted });
        }
        continue;
      }

      if (toolUses.length && message.role === 'assistant') {
        const text = content.filter(b => b.type === 'text').map(b => b.text).join('');
        messages.push({
          role: 'assistant',
          content: text || null,
          tool_calls: toolUses.map((call, i) => {
            const out = {
              id: call.id,
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.input || {}) }
            };
            /* Gemini puts the signature on the first call of a step and
               validates that one; see GEMINI_SIGNATURE_PLACEHOLDER. */
            if (provider.vendor === 'google') {
              const signature = call.thought_signature || (i === 0 ? GEMINI_SIGNATURE_PLACEHOLDER : '');
              if (signature) out.extra_content = { google: { thought_signature: signature } };
            }
            return out;
          })
        });
        continue;
      }
    }

    const converted = anthropicBlocksToOpenAI(content, allowImages);
    if (converted && converted.length) messages.push({ role: message.role, content: converted });
  }

  const tools = (body.tools || [])
    .filter(tool => tool && tool.name && tool.input_schema)
    .map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: tool.input_schema
      }
    }));

  const request = {
    model: provider.model,
    messages: messages,
    max_tokens: body.max_tokens || 4096,
    stream: !!body.stream
  };
  if (tools.length) request.tools = tools;

  if (provider.vendor === 'google' && !googleRejectsReasoningEffort) {
    request.reasoning_effort = env.REASONING_EFFORT || 'none';
  }
  return request;
}

/* finish_reason alone is not trustworthy: some OpenAI-compatible providers
   (seen from Groq and OpenRouter's free models in particular) return a real
   tool_calls array while reporting finish_reason "stop" instead of
   "tool_calls" — a bug on their side, not a shape we can rely on. Mapped
   naively, that produced stop_reason "end_turn" alongside an actual
   tool_use block: the client's tool loop checks stop_reason to decide
   whether to run the tool, saw "end_turn", never ran it, and the user got
   an empty reply despite the model having done real work.
   hasToolCalls lets the content itself override a mismatched label. */
function mapFinishReason(reason, hasToolCalls) {
  if (reason === 'tool_calls' || hasToolCalls) return 'tool_use';
  if (reason === 'length') return 'max_tokens';
  return 'end_turn';
}

function stripLeadingThinkingBlock(text) {
  if (!text) return text;
  const match = /^\s*<(thought|thinking)>[\s\S]*?<\/\1>\s*/i.exec(text);
  return match ? text.slice(match[0].length) : text;
}

/* GEMINI'S THOUGHT SIGNATURES. Gemini 3 hands back an opaque signature with
   each step's function calls (tool_calls[].extra_content.google.
   thought_signature) and refuses the next request if a replayed call has
   lost it: "Function call is missing a thought_signature ...". That 400
   says "model" in it, so shouldFailover read it as a dead engine and the
   turn fell to whatever came next — a text-only engine, with the picture
   he had just sent stripped out on the way. Every tool round on Gemini
   ended like that.

   So the signature travels on the tool_use block itself, as
   thought_signature: the page keeps each block exactly as it arrived and
   sends it back verbatim, which brings it here again on the next round.
   It is put back where Gemini looks for it, and taken off for Anthropic,
   which refuses a field it does not know. A call with no signature at all
   (an older page, or a call another engine made earlier in the turn) gets
   the placeholder Google documents for exactly that case. */
const GEMINI_SIGNATURE_PLACEHOLDER = 'skip_thought_signature_validator';

function thoughtSignatureOf(call) {
  const google = call && call.extra_content && call.extra_content.google;
  return (google && typeof google.thought_signature === 'string' && google.thought_signature) || '';
}

function withoutThoughtSignatures(body) {
  const carries = (body && body.messages || []).some(m => Array.isArray(m.content) &&
    m.content.some(b => b && b.type === 'tool_use' && 'thought_signature' in b));
  if (!carries) return body;
  return {
    ...body,
    messages: body.messages.map(m => !Array.isArray(m.content) ? m : {
      ...m,
      content: m.content.map(b => {
        if (!b || b.type !== 'tool_use' || !('thought_signature' in b)) return b;
        const { thought_signature, ...rest } = b;
        return rest;
      })
    })
  };
}

function openAIMessageToAnthropic(data) {
  const choice = (data.choices || [])[0] || {};
  const message = choice.message || {};
  const content = [];
  if (message.content) content.push({ type: 'text', text: stripLeadingThinkingBlock(message.content) });
  for (const call of (message.tool_calls || [])) {
    let input = {};
    try { input = JSON.parse((call.function && call.function.arguments) || '{}'); } catch (e) {}
    const block = {
      type: 'tool_use',
      id: call.id,
      name: call.function && call.function.name,
      input: input
    };
    const signature = thoughtSignatureOf(call);
    if (signature) block.thought_signature = signature;
    content.push(block);
  }
  return {
    content: content,
    stop_reason: mapFinishReason(choice.finish_reason, (message.tool_calls || []).length > 0),
    usage: { output_tokens: (data.usage && data.usage.completion_tokens) || 0 }
  };
}

function openAIStreamToAnthropic(upstreamBody) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = '';
  let textOpen = false;
  let stopReason = 'end_turn';
  let outputTokens = 0;
  const toolBlocks = new Map();
  const signed = new Set();
  let lastSlot = null;
  let nextIndex = 1;

  let leadingBuffer = '';
  let leadingResolved = false;
  let strippingThinking = false;
  let thinkingTag = '';
  const LEADING_BUFFER_LIMIT = 4000;

  function stripLeadingThinkingFromStream(text) {
    if (leadingResolved) return text;
    leadingBuffer += text;
    if (leadingBuffer.length > LEADING_BUFFER_LIMIT) {
      const all = leadingBuffer;
      leadingResolved = true;
      strippingThinking = false;
      leadingBuffer = '';
      return all;
    }
    if (!strippingThinking) {
      const trimmed = leadingBuffer.replace(/^\s+/, '');
      if (!trimmed) return '';
      const openMatch = /^<(thought|thinking)>/i.exec(trimmed);
      if (openMatch) {
        strippingThinking = true;
        thinkingTag = openMatch[1];
      } else if (trimmed[0] !== '<' || trimmed.length > 12) {
        leadingResolved = true;
        leadingBuffer = '';
        return trimmed;
      } else {
        return '';
      }
    }
    const closeRe = new RegExp('</' + thinkingTag + '>', 'i');
    const closeMatch = closeRe.exec(leadingBuffer);
    if (closeMatch) {
      const after = leadingBuffer.slice(closeMatch.index + closeMatch[0].length).replace(/^\s+/, '');
      leadingResolved = true;
      strippingThinking = false;
      leadingBuffer = '';
      return after;
    }
    return '';
  }

  return new ReadableStream({
    async start(controller) {
      const send = (event, payload) => {
        controller.enqueue(encoder.encode(
          'event: ' + event + '\ndata: ' + JSON.stringify(payload) + '\n\n'));
      };

      send('message_start', { type: 'message_start', message: { role: 'assistant', content: [] } });

      const reader = upstreamBody.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let cut;
          while ((cut = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, cut).trim();
            buffer = buffer.slice(cut + 1);
            if (!line || line.indexOf('data:') !== 0) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;

            let chunk;
            try { chunk = JSON.parse(payload); } catch (e) { continue; }
            if (chunk.usage && chunk.usage.completion_tokens) outputTokens = chunk.usage.completion_tokens;

            const choice = (chunk.choices || [])[0];
            if (!choice) continue;
            const delta = choice.delta || {};

            if (delta.content) {
              const visible = stripLeadingThinkingFromStream(delta.content);
              if (visible) {
                if (!textOpen) {
                  send('content_block_start', { type: 'content_block_start', index: 0,
                       content_block: { type: 'text', text: '' } });
                  textOpen = true;
                }
                send('content_block_delta', { type: 'content_block_delta', index: 0,
                     delta: { type: 'text_delta', text: visible } });
              }
            }

            for (const call of (delta.tool_calls || [])) {
              /* Gemini sends each call whole, often with no index at all, so
                 two calls in one step both landed in slot 0 and became one
                 call with the second's arguments glued onto the first's.
                 With no index, the id tells calls apart; with neither, the
                 chunk continues the call before it. */
              const slot = call.index != null ? 'i' + call.index
                         : call.id ? 'id:' + call.id
                         : (lastSlot || 'i0');
              lastSlot = slot;
              const signature = thoughtSignatureOf(call);
              if (!toolBlocks.has(slot)) {
                const index = nextIndex++;
                toolBlocks.set(slot, index);
                const block = { type: 'tool_use', id: call.id || ('call_' + index),
                                name: (call.function && call.function.name) || '', input: {} };
                if (signature) { block.thought_signature = signature; signed.add(slot); }
                send('content_block_start', { type: 'content_block_start', index: index, content_block: block });
              } else if (signature && !signed.has(slot)) {
                signed.add(slot);
                send('content_block_delta', { type: 'content_block_delta', index: toolBlocks.get(slot),
                     delta: { type: 'thought_signature_delta', thought_signature: signature } });
              }
              const argsChunk = call.function && call.function.arguments;
              if (argsChunk) {
                send('content_block_delta', {
                  type: 'content_block_delta', index: toolBlocks.get(slot),
                  delta: { type: 'input_json_delta', partial_json: argsChunk }
                });
              }
            }

            if (choice.finish_reason) stopReason = mapFinishReason(choice.finish_reason, toolBlocks.size > 0);
          }
        }
      } catch (err) {
        send('error', { type: 'error', error: { message: String((err && err.message) || err) } });
      }

      if (!leadingResolved && leadingBuffer) {
        const leftover = strippingThinking ? '' : leadingBuffer;
        leadingResolved = true;
        leadingBuffer = '';
        if (leftover) {
          if (!textOpen) {
            send('content_block_start', { type: 'content_block_start', index: 0,
                 content_block: { type: 'text', text: '' } });
            textOpen = true;
          }
          send('content_block_delta', { type: 'content_block_delta', index: 0,
               delta: { type: 'text_delta', text: leftover } });
        }
      }

      if (textOpen) send('content_block_stop', { type: 'content_block_stop', index: 0 });
      for (const index of toolBlocks.values()) {
        send('content_block_stop', { type: 'content_block_stop', index: index });
      }
      send('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason },
                              usage: { output_tokens: outputTokens } });
      send('message_stop', { type: 'message_stop' });
      controller.close();
    }
  });
}

async function handleFallbackTest(env, request) {
  const chain = engineChain(env);
  if (!chain.length) {
    return json({ ok: false, engines: [], error: 'nothing configured' }, 200, env, request);
  }
  const engines = await Promise.all(chain.map(e => probeEngine(e, env)));
  return json({
    ok: engines.some(e => e.ok),
    all_ok: engines.every(e => e.ok),
    engines: engines,
    vendor: engines[0].vendor, model: engines[0].model,
    error: engines.some(e => e.ok) ? undefined
         : (engines[0].error || 'no engine answered')
  }, 200, env, request);
}

async function probeEngine(engine, env) {
  const base = { slot: engine.slot, vendor: engine.vendor, model: engine.model, label: engine.label };
  /* Workers AI has no endpoint to probe — it is a binding. Exercise it the
     same way it will actually be used, or TEST ENGINES would try to fetch an
     undefined URL and report the one always-available engine as broken. */
  if (engine.vendor === 'workers-ai') {
    if (!env || !env.AI) return { ...base, ok: false, reason: 'other', error: 'the AI binding is missing' };
    try {
      const out = await env.AI.run(engine.model, {
        messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
        max_tokens: 16
      });
      const said = String((out && (out.response || out.result)) || '').trim();
      return said ? { ...base, ok: true, said: said.slice(0, 40) }
                  : { ...base, ok: false, reason: 'other', error: 'returned nothing' };
    } catch (err) {
      const msg = String((err && err.message) || err);
      return { ...base, ok: false,
               reason: /limit|quota|neuron/i.test(msg) ? 'no_credit' : 'other',
               error: /limit|quota|neuron/i.test(msg)
                 ? 'the daily free Neuron allowance is used up (resets 00:00 UTC)'
                 : msg.slice(0, 160) };
    }
  }
  let upstream;
  try {
    upstream = engine.vendor === 'anthropic'
      ? await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': engine.key,
                     'anthropic-version': ANTHROPIC_VERSION },
          body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 16,
                                 messages: [{ role: 'user', content: 'Reply with the single word: ready' }] })
        })
      : await fetch(engine.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + engine.key },
          body: JSON.stringify({ model: engine.model, max_tokens: 16,
                                 messages: [{ role: 'user', content: 'Reply with the single word: ready' }] })
        });
  } catch (err) {
    return { ...base, ok: false, reason: 'unreachable', error: 'could not reach ' + engine.url };
  }
  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    const reason = failureReason(upstream.status, detail);
    return { ...base, ok: false, status: upstream.status, reason: reason,
      error: reason === 'key_rejected'  ? 'the key was rejected'
           : reason === 'no_credit'     ? 'no credit or quota left'
           : reason === 'rate_limited'  ? 'rate limited right now'
           : reason === 'no_such_model' ? 'this account has no model called ' + engine.model +
                                          ' — set ' + engine.modelVar + ' to one it does have'
           : detail.slice(0, 160) };
  }
  const data = await upstream.json().catch(() => ({}));
  const said = engine.vendor === 'anthropic'
    ? ((data.content || []).find(b => b.type === 'text') || {}).text || ''
    : ((((data.choices || [])[0] || {}).message || {}).content || '');
  return { ...base, ok: true, said: String(said).trim().slice(0, 40) };
}

const modelListCache = new Map();

const NOT_A_CHAT_MODEL = /whisper|tts|embed|rerank|moderation|guard|safety|vision-only|image|audio|transcribe|distil/i;

async function pickAvailableModel(engine) {
  const listUrl = engine.url.replace(/\/chat\/completions\/?$/, '/models');
  if (modelListCache.has(listUrl)) return modelListCache.get(listUrl);
  let ids = [];
  try {
    const res = await fetch(listUrl, { headers: { 'Authorization': 'Bearer ' + engine.key } });
    if (!res.ok) return null;
    const data = await res.json();
    ids = (data.data || data.models || [])
      .map(m => (typeof m === 'string' ? m : m.id))
      .filter(Boolean)
      .map(id => id.replace(/^models\//, ''))
      .filter(id => !NOT_A_CHAT_MODEL.test(id));
  } catch (e) { return null; }
  if (!ids.length) return null;

  if (engine.vendor === 'openrouter') {
    const free = ids.filter(id => /:free$/.test(id));
    if (free.length) ids = free;
  }
  let preferred;
  if (engine.vendor === 'google') {
    preferred = ids.filter(id => /^(models\/)?gemini/i.test(id));
    if (!preferred.length) preferred = ids.filter(id => /instruct|chat|versatile|it\b|oss/i.test(id));
  } else {
    preferred = ids.filter(id => /instruct|chat|versatile|it\b|oss/i.test(id));
  }
  const chosen = (preferred.length ? preferred : ids)[0];
  modelListCache.set(listUrl, chosen);
  return chosen;
}

function mcpConfig(env, slug) {
  const key = slug.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const url = env['MCP_' + key + '_URL'];
  if (!url) return null;
  return {
    url: url,
    apiKey: env['MCP_' + key + '_KEY'] || '',
    header: env['MCP_' + key + '_HEADER'] || 'x-api-key'
  };
}

async function handleMcpProxy(request, env, path) {
  const slug = path.slice('/mcp/'.length).split('/')[0];
  if (!slug) return json({ error: 'no MCP name in the path' }, 400, env, request);

  const config = mcpConfig(env, slug);
  if (!config) {
    return json({
      error: 'no MCP server configured under "' + slug + '". Add secrets MCP_' +
             slug.toUpperCase() + '_URL and MCP_' + slug.toUpperCase() + '_KEY.'
    }, 503, env, request);
  }

  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
  if (config.apiKey) headers[config.header] = config.apiKey;

  const upstream = await fetch(config.url, {
    method: request.method === 'GET' ? 'GET' : 'POST',
    headers: headers,
    body: request.method === 'GET' ? undefined : await request.text()
  });

  const contentType = upstream.headers.get('Content-Type') || 'application/json';
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store', ...cors(env, request) }
  });
}

const IMAGE_GEN_MODEL  = '@cf/black-forest-labs/flux-1-schnell';
const IMAGE_EDIT_MODEL = '@cf/black-forest-labs/flux-2-klein-9b';

function stripDataUrl(s) {
  return String(s || '').replace(/^data:[^;]+;base64,/, '');
}

async function toBase64Image(result) {
  if (!result) return null;
  if (typeof result === 'string') return result;
  if (result.image) return result.image;
  if (result instanceof ArrayBuffer || ArrayBuffer.isView(result)) {
    const bytes = new Uint8Array(result instanceof ArrayBuffer ? result : result.buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  if (typeof result.getReader === 'function') {
    const chunks = [];
    const reader = result.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    let total = 0;
    for (const c of chunks) total += c.length;
    const all = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { all.set(c, off); off += c.length; }
    let bin = '';
    for (let i = 0; i < all.length; i++) bin += String.fromCharCode(all[i]);
    return btoa(bin);
  }
  return null;
}

async function handleImage(request, env) {
  if (!env.AI) {
    return json({ error: 'Workers AI is not bound. In the dashboard: Settings -> Bindings -> Add -> Workers AI, variable name AI, then Deploy.' }, 503, env, request);
  }
  const body = await request.json().catch(() => ({}));
  const prompt = String((body && body.prompt) || '').trim().slice(0, 2000);
  if (!prompt) return json({ error: 'no prompt' }, 400, env, request);

  const reference = body && body.reference ? stripDataUrl(body.reference) : null;
  const steps = Math.min(8, Math.max(1, parseInt((body && body.steps) || 4, 10) || 4));

  const attempts = reference ? [
    { model: IMAGE_EDIT_MODEL, shape: 'image_b64[]', input: { prompt, image_b64: [reference] } },
    { model: IMAGE_EDIT_MODEL, shape: 'images[]',    input: { prompt, images: [reference] } },
    { model: IMAGE_EDIT_MODEL, shape: 'image',       input: { prompt, image: reference } },
    { model: IMAGE_EDIT_MODEL, shape: 'prompt only', input: { prompt } },
    { model: IMAGE_GEN_MODEL,  shape: 'fallback',    input: { prompt, steps } }
  ] : [
    { model: IMAGE_EDIT_MODEL, shape: 'prompt only', input: { prompt } },
    { model: IMAGE_GEN_MODEL,  shape: 'fallback',    input: { prompt, steps } }
  ];

  const tried = [];
  for (const attempt of attempts) {
    try {
      const result = await env.AI.run(attempt.model, attempt.input);
      const image = await toBase64Image(result);
      if (!image) { tried.push(attempt.shape + ': no image in response'); continue; }
      return json({
        ok: true,
        image: image,
        model: attempt.model,
        shape: attempt.shape,
        used_reference: !!reference && attempt.shape !== 'fallback' && attempt.shape !== 'prompt only',
        tried: tried
      }, 200, env, request);
    } catch (err) {
      tried.push(attempt.shape + ': ' + String((err && err.message) || err).slice(0, 160));
    }
  }
  return json({ error: 'every image attempt failed', tried: tried }, 502, env, request);
}

/* One store used to be the only shape this supported: two flat secrets, no
   name to address it by because there was nothing to disambiguate. Multiple
   stores need a name for each — "how's the AURA store doing" only means
   anything if something maps "AURA" to a subdomain and a token. SHOPIFY_STORES
   carries that list; the old two secrets still work and are folded in here,
   so nothing already configured breaks by this shipping. */
function shopifyStores(env) {
  const stores = [];
  const seen = new Set();

  if (env.SHOPIFY_STORES) {
    try {
      const parsed = JSON.parse(env.SHOPIFY_STORES);
      if (Array.isArray(parsed)) {
        for (const s of parsed) {
          const store = String((s && s.store) || '').trim();
          const token = String((s && s.token) || '').trim();
          const name = String((s && s.name) || store).trim();
          if (!store || !token || !name) continue;
          const key = name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          stores.push({ name, store, token });
        }
      }
    } catch (e) { /* malformed JSON: fall through, the single-store fields still work */ }
  }

  if (env.SHOPIFY_STORE && env.SHOPIFY_ADMIN_TOKEN) {
    const store = String(env.SHOPIFY_STORE).trim();
    const name = store;
    if (!seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      stores.push({ name, store, token: String(env.SHOPIFY_ADMIN_TOKEN).trim() });
    }
  }

  return stores;
}

function findStore(env, name) {
  const stores = shopifyStores(env);
  if (!stores.length) return null;
  const want = String(name || '').trim().toLowerCase();
  if (!want) return stores.length === 1 ? stores[0] : null; // >1 store with no name is ambiguous, not a default
  return stores.find(s => s.name.toLowerCase() === want) || null;
}

/* ------------------------------ Speech to text -----------------------
   The browser's own SpeechRecognition is a different class of tool from what
   a phone's assistant uses: it is locked to one language at a time, its
   quality varies wildly between browsers, and on iOS Safari it is weak
   enough that a clear sentence often needs repeating. Whisper is a real ASR
   model — it identifies the language itself, which is the part that matters
   here, because "build me a landing page" spoken inside a Hebrew sentence is
   exactly what a single-language recogniser gets wrong.

   Runs on the Workers AI binding already used for images, so there is no new
   key and no new bill. Audio arrives as raw bytes in the request body.
--------------------------------------------------------------------- */

/* Order matters, and it changed. turbo is a DISTILLED model: fewer decoder
   layers, much faster, and the distillation costs the most in languages other
   than English — which is exactly where the complaints are. The full
   large-v3 goes first now and turbo becomes the fallback, trading a few
   hundred milliseconds for noticeably better Hebrew.

   If English ever starts feeling slow, swapping these two lines back is the
   whole change. */
const WHISPER_MODELS = [
  '@cf/openai/whisper-large-v3',          // full model: best non-English accuracy
  '@cf/openai/whisper-large-v3-turbo',    // distilled: faster, weaker on Hebrew
  '@cf/openai/whisper'                    // original, last resort
];

/* What Whisper says when it has nothing to say.
 
   Given silence, a fragment, or audio in a language it has been told not to
   expect, Whisper does not fail and does not return empty \u2014 it emits the
   phrase it saw most often in training. The list is small, famous, and almost
   entirely drawn from the end of YouTube videos, which is what the training
   data was.
 
   Filtered only for SHORT audio: if he genuinely says "thanks" in a long
   sentence it survives, and a short standalone "thank you" is not a command,
   so dropping it costs nothing and mis-hearing it costs a whole turn. */
const WHISPER_NOISE = [
  'thank you', 'thanks', 'thank you very much', 'thank you so much',
  'thanks for watching', 'thank you for watching', 'thanks for watching!',
  'please subscribe', 'subscribe', 'like and subscribe', 'see you next time',
  'bye', 'bye bye', 'goodbye', 'you', 'the', 'so', 'okay', 'ok', 'uh', 'um',
  'music', 'applause', 'silence', 'blank_audio', 'inaudible', 'foreign',
  '\u05ea\u05d5\u05d3\u05d4', '\u05ea\u05d5\u05d3\u05d4 \u05e8\u05d1\u05d4', '\u05ea\u05d5\u05d3\u05d4 \u05e9\u05e6\u05e4\u05d9\u05ea\u05dd',
  '\u05dc\u05d4\u05ea\u05e8\u05d0\u05d5\u05ea', '\u05e9\u05dc\u05d5\u05dd', '\u05db\u05df',
  'amara.org', 'subtitles by the amara.org community', 'www.amara.org'
];

/* Roughly a second and a half of opus. Under this, a result matching the list
   above is far more likely to be the noise than the words. */
const WHISPER_SHORT_BYTES = 14000;

function whisperBare(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\[\]()*_~♪♩·]/g, ' ')
    .replace(/[.,!?;:…׳״'"-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* The list, put through the same normaliser as the transcript.

   Written by hand it could not have worked: "amara.org" and "blank_audio"
   both lose their punctuation on the way in, so the entries as typed were
   unreachable and [BLANK_AUDIO] sailed straight through as a command.
   Normalising both sides is the only version of this that stays correct
   when someone adds a phrase with an apostrophe in it. */
const WHISPER_NOISE_SET = WHISPER_NOISE.map(whisperBare);

function isWhisperHallucination(text, byteLength) {
  const bare = whisperBare(text);
  if (!bare) return true;
  if (byteLength >= WHISPER_SHORT_BYTES) return false;   // long enough to be real speech
  return WHISPER_NOISE_SET.indexOf(bare) >= 0;
}

/* HEARING THAT DOES NOT SPEND THE WORKERS AI ALLOWANCE (worker 2.8.0).

   Transcription ran only on Workers AI, whose free 10,000 neurons a day are
   shared with the voice, picture descriptions and the backup brain; when
   they ran out he could not be heard at all until midnight UTC, and to him
   that was JARVIS not answering. Groq serves the same Whisper (large-v3
   turbo) with its own free allowance (2,000 requests and 8 hours of audio a
   day). It goes first whenever a Groq key exists anywhere in the worker —
   GROQ_API_KEY, or a gsk_ key already in a PRIMARY/FALLBACK slot for the
   chat chain, so no new secret is needed if he has one — and Workers AI
   stays behind it, exactly as before, when Groq refuses or finds only a
   hallucination. */
const GROQ_STT_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_STT_MODEL = 'whisper-large-v3-turbo';
const GROQ_KEY_SLOTS = ['GROQ_API_KEY', 'GROQ_KEY', 'PRIMARY_API_KEY', 'FALLBACK_API_KEY',
                        'FALLBACK_API_KEY_2', 'FALLBACK_API_KEY_3', 'FALLBACK_API_KEY_4', 'FALLBACK_API_KEY_5'];
function groqSttKey(env) {
  for (const name of GROQ_KEY_SLOTS) {
    const v = String(env[name] || '').trim().replace(/^['"]+|['"]+$/g, '').replace(/^Bearer\s+/i, '').trim();
    const m = /gsk_[A-Za-z0-9]+/.exec(v);
    if (m) return { key: m[0], name };
  }
  return null;
}
/* What the recording is, from its first bytes — Groq wants a file name it
   recognises. MediaRecorder gives webm (or ogg, or mp4 on some builds). */
function audioFileOf(bytes) {
  const b = bytes, at = (i, s) => s.split('').every((c, k) => b[i + k] === c.charCodeAt(0));
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { name: 'speech.webm', type: 'audio/webm' };
  if (at(0, 'OggS')) return { name: 'speech.ogg', type: 'audio/ogg' };
  if (at(0, 'RIFF')) return { name: 'speech.wav', type: 'audio/wav' };
  if (at(4, 'ftyp')) return { name: 'speech.m4a', type: 'audio/mp4' };
  if (at(0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { name: 'speech.mp3', type: 'audio/mpeg' };
  if (at(0, 'fLaC')) return { name: 'speech.flac', type: 'audio/flac' };
  return { name: 'speech.webm', type: 'audio/webm' };
}
async function groqTranscribe(env, bytes, lang) {
  const k = groqSttKey(env);
  if (!k) return null;
  const file = audioFileOf(bytes);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: file.type }), file.name);
  form.append('model', String(env.GROQ_STT_MODEL || GROQ_STT_MODEL));
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');
  if (lang) form.append('language', lang);
  const res = await fetch(GROQ_STT_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + k.key }, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String((data && data.error && (data.error.message || data.error.code)) || '').slice(0, 140);
    throw new Error('groq ' + res.status + (msg ? ': ' + msg : ''));
  }
  return { text: String((data && data.text) || '').trim(), language: (data && data.language) || null,
           model: 'groq:' + String(env.GROQ_STT_MODEL || GROQ_STT_MODEL) };
}

async function handleStt(request, env) {
  if (!env.AI && !groqSttKey(env)) {
    return json({ error: 'Workers AI is not bound and there is no Groq key: add the AI binding in the dashboard, or a GROQ_API_KEY' }, 503, env, request);
  }
  const buf = await request.arrayBuffer().catch(() => null);
  if (!buf || buf.byteLength < 800) {
    return json({ error: 'no audio', bytes: buf ? buf.byteLength : 0 }, 400, env, request);
  }
  const bytes = new Uint8Array(buf);
  const groqTried = [];
  let groqDropped = null;
  if (groqSttKey(env)) {
    try {
      const g = await groqTranscribe(env, bytes, null);
      if (!g.text) {
        /* Groq's large-v3 turbo ran and heard no words: that is silence, and
           the Workers AI chain is not asked again (it costs neurons). */
        return json({ ok: true, text: '', tried: [g.model + ': empty result'], dropped: null, bytes: bytes.length, via: 'groq' }, 200, env, request);
      }
      if (!isWhisperHallucination(g.text, bytes.length)) {
        return json({ ok: true, text: g.text, model: g.model, detected: g.language, dropped: null, via: 'groq' }, 200, env, request);
      }
      groqDropped = g.text;
      groqTried.push(g.model + ': hallucination (' + g.text.slice(0, 40) + ')');
    } catch (err) {
      groqTried.push(String((err && err.message) || err).slice(0, 160));
    }
    if (!env.AI) {
      /* No second route: a hallucination is silence; a refusal is said as one. */
      if (groqDropped) return json({ ok: true, text: '', tried: groqTried, dropped: groqDropped, bytes: bytes.length, via: 'groq' }, 200, env, request);
      const quota = groqTried.find(t => /429|rate limit|quota/i.test(t));
      return json({ error: (quota ? 'the Groq transcription allowance is spent for now — ' : 'Groq transcription failed: ') + groqTried.join(' | '),
                    tried: groqTried }, quota ? 429 : 502, env, request);
    }
  }

  /* The two models want the audio in different shapes — the turbo one takes
     base64, the original takes a plain byte array. Rather than pin a guess,
     try each in the order we prefer them and report which worked. */
  let b64 = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    b64 += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  b64 = btoa(b64);

  /* THE LANGUAGE, AND WHY IT IS NO LONGER A LOCK.
 
     Every transcription used to arrive carrying ?language=he, because that is
     what the interface was set to. Say "open youtube" in English into a
     Hebrew-locked Whisper and it does not return empty and it does not return
     English — it returns, with complete confidence, its single most common
     training phrase. Usually "Thank you." So the assistant was answering
     "you're welcome" to a request to open YouTube, and the fallbacks below
     never ran, because a hallucination is not an empty string.
 
     This user speaks both languages and mixes them inside one sentence; his
     own prompt says so. Locking either one is wrong for him by construction.
 
     So: detect first, and keep the hint only as a second opinion for when
     detection comes back with nothing usable. */
  const url = new URL(request.url);
  const hint = url.searchParams.get('language');
  const lang = (hint === 'he' || hint === 'en') ? hint : null;
  const withLang = (input) => lang ? { ...input, language: lang } : input;

  /* THE WORDS HE ACTUALLY SAYS.

     Whisper takes a prompt of expected vocabulary and leans towards it.
     Without one it has never heard of this user's world, so "Shopify" comes
     back as "shopfly", "TikTok" as "tick tock", and his own assistant's name
     as almost anything. These are the words that appear in his commands more
     than any others, in both scripts, and naming them costs nothing.

     Add to it without touching this file by setting STT_VOCAB on the worker:
     product names, a brand, a supplier — whatever he says that a general
     model would not expect.

     Only the turbo model documents initial_prompt, so only it is given one,
     and a plain attempt at the same model follows in case it is refused. */
  const vocab = ('JARVIS, Shopify, Instagram, TikTok, Claude, Cloudflare, API, ' +
                 'GlowPulse, \u05d2\u05f3\u05e8\u05d5\u05d5\u05d9\u05e1, \u05e9\u05d5\u05e4\u05d9\u05e4\u05d9\u05d9, \u05d0\u05d9\u05e0\u05e1\u05d8\u05d2\u05e8\u05dd, \u05d8\u05d9\u05e7\u05d8\u05d5\u05e7, \u05e7\u05dc\u05d0\u05d5\u05d3' +
                 (env.STT_VOCAB ? ', ' + String(env.STT_VOCAB).slice(0, 400) : '') + '.');
  const withVocab = (input) => ({ ...input, initial_prompt: vocab });

  const attempts = [
    { model: WHISPER_MODELS[0], input: { audio: b64 } },                          // detect
    { model: WHISPER_MODELS[1], input: withVocab({ audio: b64 }) },               // detect, told his words
    { model: WHISPER_MODELS[1], input: { audio: b64 } },                          // detect, plain
    { model: WHISPER_MODELS[0], input: withLang({ audio: b64 }) },                // second opinion
    { model: WHISPER_MODELS[2], input: { audio: [...bytes] } },
    { model: WHISPER_MODELS[1], input: withLang(withVocab({ audio: [...bytes] })) }
  ];

  const tried = groqTried.slice();
  let firstDropped = groqDropped;
  let ran = 0;          // attempts where a model actually ran, whatever it returned
  let empties = 0;      // ...and found no words
  for (const attempt of attempts) {
    try {
      const out = await env.AI.run(attempt.model, attempt.input);
      ran++;
      const text = ((out && (out.text || out.transcription || '')) || '').trim();
      /* Two models that ran and found no words have answered: there was no
         speech. Running all six on the same audio used to follow, and every
         one of them costs neurons — on a room's silence that was six
         transcriptions for nothing, which is how the free daily allowance
         ran out. The chain exists for hallucinations (a phrase where there
         were no words, or the wrong language), which still run it all.
         Two rather than one, so a single model that cannot read this audio
         does not get the last word. */
      if (!text) {
        tried.push(attempt.model + ': empty result');
        if (++empties >= 2) break;
        continue;
      }
      if (isWhisperHallucination(text, bytes.length)) {
        /* Not a transcript \u2014 the noise Whisper makes when it has nothing.
           Treated as silence so the next model gets a turn, and reported, so
           this never becomes invisible again. */
        if (!firstDropped) firstDropped = text;
        tried.push(attempt.model + ': hallucination (' + text.slice(0, 40) + ')');
        continue;
      }
      return json({
        ok: true, text: text, model: attempt.model,
        detected: out && out.language ? out.language : null,
        dropped: firstDropped
      }, 200, env, request);
    } catch (err) {
      tried.push(attempt.model + ': ' + String((err && err.message) || err).slice(0, 140));
    }
  }
  /* NO MODEL RAN AT ALL, WHICH IS NOT SILENCE.

     This used to answer 200 with empty text either way, so a spent daily
     allowance, a broken binding or a model Cloudflare had withdrawn all
     reached the page as "he said nothing": "Say that again?" to every
     sentence with a held key, and hands-free, nothing whatsoever. Only a
     model that ran and found no words is silence. Anything else is an
     error, said as one, so the page can say out loud what is wrong. */
  if (!ran) {
    const quota = tried.find(t => /4006|daily free allocation|neurons?\b|quota|rate limit/i.test(t));
    return json({
      error: quota
        ? 'the daily free Workers AI allowance (neurons) is spent — ' + quota
        : 'every transcription model failed: ' + tried.join(' | '),
      tried: tried
    }, quota ? 429 : 502, env, request);
  }
  // Silence is a legitimate outcome, not a failure — the caller just ignores it.
  return json({ ok: true, text: '', tried: tried, dropped: firstDropped, bytes: bytes.length }, 200, env, request);
}

/* Searching, without needing Anthropic.

   The page already had a search tool, but it was Anthropic's server-side one:
   the worker notices a server tool in the request, puts an Anthropic engine
   first, and if there is no ANTHROPIC_API_KEY the tool is dropped from the
   request on its way to Google or Groq. Nothing errors. He simply answers
   from memory as though he had searched, which is worse than having no search
   at all, because there is no sign it did not happen.

   This is an ordinary endpoint, so a tool built on it survives on every
   engine in the chain. DuckDuckGo's HTML endpoint is used because it needs no
   key and no account — the cost is that it is markup meant for a browser
   rather than an API, so when the parse finds nothing the honest answer is
   "search returned nothing usable", never an empty list dressed up as "no
   results", which the model would report to him as fact. */
const SEARCH_TIMEOUT_MS = 10000;
const SEARCH_MAX_RESULTS = 8;

function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0?39;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
function stripTags(s) { return decodeEntities(String(s || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(); }

/* DuckDuckGo wraps every hit in a redirect of its own, with the real address
   in uddg=. Unwrapped here rather than handed over as-is, so the model reads
   and quotes the actual domain instead of a duckduckgo.com link. */
function unwrapDuck(href) {
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    const real = u.searchParams.get('uddg');
    if (real) return real;
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch (e) { return null; }
}

async function handleSearch(request, env) {
  const body = await request.json().catch(() => ({}));
  const query = String((body && body.query) || '').trim().slice(0, 400);
  if (!query) return json({ error: 'no query' }, 400, env, request);
  const result = await searchCore(query);
  return json(result.body, result.status, env, request);
}

/* The actual DuckDuckGo call and parse, pulled out of handleSearch so an
   agent running from the Cron Trigger — competitor and news intelligence,
   which have no page to call /search through — can make the identical call
   in-process. Returns {status, body} rather than a Response, since only
   handleSearch has a Request/env pair to build CORS headers from. */
async function searchCore(query) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), SEARCH_TIMEOUT_MS);
  let html = '';
  try {
    const upstream = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
      method: 'GET',
      signal: stop.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en,he;q=0.9'
      }
    });
    clearTimeout(timer);
    if (!upstream.ok) {
      return { status: 502, body: { error: 'search is unavailable right now (' + upstream.status + ')' } };
    }
    html = await upstream.text();
  } catch (err) {
    clearTimeout(timer);
    const aborted = String((err && err.name) || '') === 'AbortError';
    return { status: 502, body: { error: aborted ? 'the search timed out' : 'could not reach the search service' } };
  }

  const results = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && results.length < SEARCH_MAX_RESULTS) {
    const url = unwrapDuck(decodeEntities(m[1]));
    const title = stripTags(m[2]);
    if (!url || !title) continue;
    if (results.some(r => r.url === url)) continue;
    results.push({ title, url, snippet: '' });
  }

  /* Snippets are in their own elements, in the same order as the links. */
  const snips = [...html.matchAll(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map(x => stripTags(x[1]));
  results.forEach((r, i) => { if (snips[i]) r.snippet = snips[i].slice(0, 400); });

  if (!results.length) {
    /* Said plainly. An empty list would be reported to him as "nothing exists
       about that", which is a different and false claim. */
    return { status: 200, body: { ok: false, query: query, results: [],
      error: 'the search returned nothing this worker could read — treat it as search being unavailable, not as the topic having no results' } };
  }
  return { status: 200, body: { ok: true, query: query, count: results.length, results: results } };
}

/* Reading one page, as opposed to searching. web_search answers "what is out
   there" from an index; it cannot answer "what does THIS page say", which is
   what actually gets asked — a competitor's product page, a spec sheet, a
   supplier listing, a thread somebody linked. open_url puts such a page on
   his screen and deliberately tells the model nothing about it, so until now
   there was no way for him to read inside a site at all.

   Everything here is a guard, because this endpoint takes a URL from a model
   and fetches it with the worker's own network position:

   - http and https only. Anything else is a scheme with local reach.
   - No private, loopback or link-local host. A worker has no route to a home
     LAN, but "probably cannot" is not a security boundary, and the check is
     three lines.
   - Redirects are followed by fetch, so the FINAL url is re-checked before
     its body is used — an open redirect to 169.254.169.254 is the standard
     way this endpoint gets turned into a metadata reader.
   - A timeout and a byte cap, so one enormous or one hanging page cannot
     occupy the worker.

   HTML comes back as text, not markup: the model is reading prose, and tags
   would spend its context without adding anything. */
const FETCH_TIMEOUT_MS = 12000;
const FETCH_MAX_BYTES   = 3 * 1024 * 1024;
const FETCH_MAX_CHARS   = 18000;

function blockedHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') ||
      h.endsWith('.internal') || h === '::1' || h === '0.0.0.0') return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;          // cloud metadata
    if (a >= 224) return true;                        // multicast and above
  }
  if (/^(fc|fd|fe80)/.test(h)) return true;           // IPv6 private / link-local
  return false;
}

function safeUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch (e) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (blockedHost(u.hostname)) return null;
  return u;
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|canvas|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|br)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

async function handleFetch(request, env) {
  const body = await request.json().catch(() => ({}));
  const result = await fetchPageCore(body && body.url);
  return json(result.body, result.status, env, request);
}

/* The actual fetch-and-extract, pulled out of handleFetch for the same
   reason as searchCore above: an agent running from the Cron Trigger needs
   read_page's exact behaviour — the SSRF guard in safeUrl included — without
   a Request of its own to hand handleFetch. */
async function fetchPageCore(rawUrl) {
  const target = safeUrl(rawUrl);
  if (!target) {
    return { status: 400, body: { error: 'give a full http or https address to a public page' } };
  }

  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), FETCH_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      signal: stop.signal,
      redirect: 'follow',
      headers: {
        /* Announced as a browser because a bare fetch is refused outright by
           a good share of the web, which would read here as "the page is
           empty" rather than "we were turned away". */
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
        'Accept-Language': 'en,he;q=0.9'
      }
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = String((err && err.name) || '') === 'AbortError';
    return { status: 502, body: { error: aborted ? 'the page took too long to answer' : 'could not reach that page' } };
  }
  clearTimeout(timer);

  // Redirects have already been followed, so this is where the body came from.
  const landed = safeUrl(upstream.url || target.toString());
  if (!landed) return { status: 400, body: { error: 'that address redirected somewhere not allowed' } };

  if (!upstream.ok) {
    return { status: 502, body: { error: 'the site answered ' + upstream.status, status: upstream.status,
                                   url: landed.toString() } };
  }

  const type = (upstream.headers.get('Content-Type') || '').toLowerCase();
  if (!/text\/html|text\/plain|application\/(xhtml|json|xml)|text\/xml/.test(type)) {
    return { status: 415, body: { error: 'that link is ' + (type.split(';')[0] || 'a file') + ', not a readable page',
                                   url: landed.toString() } };
  }

  const declared = Number(upstream.headers.get('Content-Length') || 0);
  if (declared && declared > FETCH_MAX_BYTES) {
    return { status: 413, body: { error: 'that page is too large to read', url: landed.toString() } };
  }

  const raw = await upstream.text().catch(() => '');
  if (raw.length > FETCH_MAX_BYTES) {
    return { status: 413, body: { error: 'that page is too large to read', url: landed.toString() } };
  }

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw);
  const text = /json|xml/.test(type) ? raw.trim() : htmlToText(raw);
  const clipped = text.length > FETCH_MAX_CHARS;

  return {
    status: 200,
    /* rawHtml rides along outside `body` (what read_page actually returns to
       a caller) so qa_check_page below can look for broken links/images and
       an add-to-cart control without a second fetch of the same page. */
    rawHtml: /json|xml/.test(type) ? '' : raw,
    contentType: type,
    body: {
      ok: true,
      url: landed.toString(),
      title: titleMatch ? htmlToText(titleMatch[1]).slice(0, 300) : '',
      text: clipped ? text.slice(0, FETCH_MAX_CHARS) : text,
      truncated: clipped,
      chars: text.length
    }
  };
}

/* The read-only guard, and it has to be exact: this endpoint holds an Admin
   API token with write scope, so whatever slips past here runs against a real
   store. The previous pair of patterns — /(^|\s)mutation\s/ and /^\s*mutation/ —
   required either a space after the keyword or the keyword at the very start
   of the string, and a parameterised mutation has neither:

     # anything\nmutation($id:ID!){ productDelete(input:{id:$id}){ ... } }

   The "(" defeats the first pattern and the leading comment defeats the
   second, so a destructive document was accepted as a read.

   Comments and strings are stripped first, because both can carry the word
   "mutation" harmlessly and both can hide one. Then any `mutation` token at
   the top level of the document is rejected, whatever follows it — a name, a
   variable list, a directive or the selection set itself. */
function containsMutation(query) {
  const stripped = String(query || '')
    .replace(/"""[\s\S]*?"""/g, ' ')   // block strings
    .replace(/"(?:\\.|[^"\\])*"/g, ' ')  // ordinary strings
    .replace(/#[^\n]*/g, ' ');         // comments
  return /\bmutation\b/i.test(stripped);
}

async function handleShopify(request, env) {
  const stores = shopifyStores(env);
  if (!stores.length) {
    return json({ error: 'shopify not configured' }, 503, env, request);
  }
  const body = await request.json().catch(() => ({}));
  const query = String((body && body.query) || '');
  if (!query.trim()) return json({ error: 'empty query' }, 400, env, request);
  /* Writes are allowed now, at the owner's explicit choice, with no approval
     step in front of them. The guard did not go away though \u2014 it turned into
     a declaration. A caller that means to change something has to say so, so
     that a document which merely mentions the word cannot become a write by
     accident, and so a read path can never be widened into a write path by a
     prompt that talked its way into the query field.

     What replaces the gate is the record: every call through here is written
     to the action log in the app, with the document and its variables, which
     is what makes a change reversible by hand. */
  const isWrite = containsMutation(query);
  if (isWrite && body.allow_writes !== true) {
    return json({
      error: 'this document contains a mutation, but the caller did not ask for a write. ' +
             'Pass allow_writes: true to change the store.'
    }, 400, env, request);
  }

  const requestedName = (body && body.store_name) || '';
  const target = findStore(env, requestedName);
  if (!target) {
    return json({
      error: requestedName
        ? 'no store named "' + requestedName + '". Configured: ' + stores.map(s => s.name).join(', ')
        : 'more than one store is configured; pass store_name. Configured: ' + stores.map(s => s.name).join(', ')
    }, 400, env, request);
  }

  const result = await shopifyGraphQL(target, query, (body && body.variables) || {});
  return json(result.data, result.ok ? 200 : 502, env, request);
}

/* The actual call to Shopify's Admin API, pulled out of handleShopify so a
   caller with no incoming Request — a scheduled agent, running from the Cron
   Trigger with nobody asking — can make the same call the same way. Nothing
   about handleShopify's own behaviour changes: it still builds `target` and
   checks `allow_writes` exactly as before, then hands off here. */
async function shopifyGraphQL(target, query, variables) {
  const storeSubdomain = target.store.replace(/\.myshopify\.com$/, '');
  const upstream = await fetch(
    `https://${storeSubdomain}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': target.token },
      body: JSON.stringify({ query, variables: variables || {} })
    }
  );
  const data = await upstream.json().catch(() => ({ error: 'bad shopify response' }));
  return { ok: upstream.ok, data };
}

/* =====================================================================
   GOOGLE CALENDAR — connected from the app, and always saying whose.

   It used to need three secrets, the third a refresh token that had to be
   minted by hand in an OAuth playground. Nobody had done that, so every
   read and write answered "calendar not configured" — and a write that
   failed like that was then reported to him as done. Asked for a meeting
   on 2 November, he was told it was in his calendar; it had gone nowhere.

   Now only the OAuth client is a secret (GOOGLE_CLIENT_ID and
   GOOGLE_CLIENT_SECRET). He says "connect my calendar", the app opens
   Google's own consent screen, he picks the account, and the callback here
   keeps the refresh token in D1 next to the name of that account. Every
   read and write says which account it touched, so "which calendar did it
   go into" has an answer instead of a guess. GOOGLE_REFRESH_TOKEN still
   works for a setup that already has one; a connection made from the app
   takes precedence over it, being the more recent choice.
   ===================================================================== */
const CALENDAR_SCOPES = 'openid email https://www.googleapis.com/auth/calendar.events';
const CALENDAR_STATE_TTL_SECONDS = 15 * 60;

/* The two values as Google issued them. Pasted into a dashboard they
   arrive with whatever came along — a trailing newline, quotes, the label
   they were copied next to ("CLIENT SECRET GOCSPX-...") — and Google then
   answers invalid_client at the very last step, after he has already
   approved everything. None of that can be part of a real value, so it is
   taken off here rather than failing on it. */
function googleClient(env) {
  const clean = v => String(v || '').trim().replace(/^['"]+|['"]+$/g, '').trim();
  let id = clean(env.GOOGLE_CLIENT_ID);
  let secret = clean(env.GOOGLE_CLIENT_SECRET);
  const idMatch = /[0-9]+-[A-Za-z0-9_]+\.apps\.googleusercontent\.com/.exec(id);
  if (idMatch) id = idMatch[0];
  const secretMatch = /GOCSPX-[A-Za-z0-9_-]+/.exec(secret);
  if (secretMatch) secret = secretMatch[0];
  return { id, secret };
}

function calendarClientConfigured(env) {
  const c = googleClient(env);
  return !!(c.id && c.secret);
}

async function storedCalendar(env) {
  if (!env.JARVIS_DB) return null;
  try {
    await ensureSchema(env);
    const row = await env.JARVIS_DB.prepare("SELECT value FROM jarvis_meta WHERE key = 'google_calendar'").first();
    return row && row.value ? JSON.parse(row.value) : null;
  } catch (e) { return null; }
}

async function saveCalendar(env, value) {
  await ensureSchema(env);
  await env.JARVIS_DB.prepare(
    "INSERT INTO jarvis_meta (key, value) VALUES ('google_calendar', ?) " +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind(JSON.stringify(value)).run();
}

/* The refresh token to use and whose calendar it opens, or null. */
async function calendarAuth(env) {
  if (!calendarClientConfigured(env)) return null;
  const stored = await storedCalendar(env);
  if (stored && stored.refresh_token) {
    return { refreshToken: stored.refresh_token, account: stored.account || null, source: 'connected' };
  }
  if (env.GOOGLE_REFRESH_TOKEN) {
    return { refreshToken: env.GOOGLE_REFRESH_TOKEN, account: null, source: 'secret' };
  }
  return null;
}

async function calendarConfigured(env) {
  return !!(await calendarAuth(env));
}

async function googleAccessToken(env, refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: googleClient(env).id,
      client_secret: googleClient(env).secret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const err = new Error('google auth failed: ' + JSON.stringify(data).slice(0, 200));
    /* invalid_grant: revoked, or expired — which is what a Google app left
       in "Testing" does to its refresh tokens after seven days. */
    err.reconnect = data.error === 'invalid_grant';
    throw err;
  }
  return data.access_token;
}

/* Every way of not reaching the calendar, said so that nobody can mistake
   it for success: nothing was read, nothing was added, and here is the one
   thing that fixes it. */
function calendarUnavailable(env, request, expired) {
  const canConnect = calendarClientConfigured(env);
  return json({
    error: expired ? 'calendar connection expired' : 'calendar not configured',
    connected: false,
    needs_connect: canConnect,
    missing: canConnect ? [] : ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    tell_the_user: canConnect
      ? (expired
          ? 'The Google Calendar connection has expired, so nothing was read or added. Say "connect my calendar" and I will open Google to reconnect it.'
          : 'Your Google Calendar is not connected yet, so nothing was read or added. Say "connect my calendar" and I will open Google to connect it.')
      : 'Your Google Calendar is not connected, so nothing was read or added: the worker is missing GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. Once those are set, say "connect my calendar".'
  }, 503, env, request);
}

async function calendarToken(env, request) {
  const auth = await calendarAuth(env);
  if (!auth) return { fail: calendarUnavailable(env, request, false) };
  try {
    return { auth, token: await googleAccessToken(env, auth.refreshToken) };
  } catch (err) {
    if (err.reconnect) return { fail: calendarUnavailable(env, request, true) };
    return { fail: json({ error: 'calendar sign-in failed: ' + String(err.message || err).slice(0, 200),
                          tell_the_user: 'Google refused the calendar sign-in, so nothing was read or added.' }, 502, env, request) };
  }
}

async function handleCalendarUpcoming(request, env, url) {
  const days = Math.min(60, Math.max(1, parseInt(url.searchParams.get('days') || '7', 10) || 7));
  const got = await calendarToken(env, request);
  if (got.fail) return got.fail;
  const now = new Date();
  const until = new Date(now.getTime() + days * 86400000);
  const api = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  api.searchParams.set('timeMin', now.toISOString());
  api.searchParams.set('timeMax', until.toISOString());
  api.searchParams.set('singleEvents', 'true');
  api.searchParams.set('orderBy', 'startTime');
  api.searchParams.set('maxResults', '40');

  const res = await fetch(api.toString(), { headers: { Authorization: 'Bearer ' + got.token } });
  const data = await res.json();
  if (!res.ok) return json({ error: 'calendar read failed', detail: data }, 502, env, request);

  const events = (data.items || []).map(e => ({
    title: e.summary || '(no title)',
    start: (e.start && (e.start.dateTime || e.start.date)) || null,
    end: (e.end && (e.end.dateTime || e.end.date)) || null,
    allDay: !!(e.start && e.start.date && !e.start.dateTime),
    location: e.location || null,
    description: e.description ? String(e.description).slice(0, 300) : null,
    link: e.htmlLink || null
  }));
  /* A primary calendar's summary is the address of the account it belongs to. */
  return json({ calendar: got.auth.account || data.summary || null, days, count: events.length, events }, 200, env, request);
}

async function handleCalendarCreate(request, env) {
  const body = await request.json().catch(() => ({}));
  const title = String((body && body.title) || '').trim();
  const start = String((body && body.start) || '').trim();
  if (!title || !start) return json({ error: 'title and start are required' }, 400, env, request);

  const timeZone = String((body && body.timeZone) || 'Asia/Jerusalem');
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(start);
  let end = String((body && body.end) || '').trim();
  if (!end) {
    if (allDay) {
      const d = new Date(start + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + 1);
      end = d.toISOString().slice(0, 10);
    } else {
      end = new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString();
    }
  }

  const event = {
    summary: title,
    description: (body && body.description) || undefined,
    location: (body && body.location) || undefined,
    start: allDay ? { date: start } : { dateTime: start, timeZone },
    end: allDay ? { date: end } : { dateTime: end, timeZone }
  };

  const got = await calendarToken(env, request);
  if (got.fail) return got.fail;
  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + got.token },
    body: JSON.stringify(event)
  });
  const data = await res.json();
  if (!res.ok) return json({ error: 'calendar write failed', detail: data,
                             tell_the_user: 'Google refused the new event, so nothing was added.' }, 502, env, request);
  return json({
    ok: true,
    calendar: got.auth.account || (data.organizer && data.organizer.email) || (data.creator && data.creator.email) || null,
    event: {
      title: data.summary,
      start: data.start && (data.start.dateTime || data.start.date),
      end: data.end && (data.end.dateTime || data.end.date),
      link: data.htmlLink
    }
  }, 200, env, request);
}

/* THE CONNECT FLOW. POST /calendar/connect (authed, from the app) answers
   with Google's consent URL; the app opens it in his browser. The state
   carried through Google is signed here and lives fifteen minutes, so the
   public callback below only ever accepts a round trip this worker began.
   Signed with its own prefix: a state is never a valid session token. */
async function signCalendarState(env) {
  const nonce = b64urlEncode(crypto.getRandomValues(new Uint8Array(12)));
  const encoded = b64urlEncode(new TextEncoder().encode(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + CALENDAR_STATE_TTL_SECONDS, n: nonce })));
  return encoded + '.' + b64urlEncode(await hmac(tokenSecret(env) || 'dev-secret', 'calendar-state.' + encoded));
}

async function verifyCalendarState(env, state) {
  if (!state || state.indexOf('.') < 0) return false;
  const [encoded, sig] = state.split('.');
  const expected = b64urlEncode(await hmac(tokenSecret(env) || 'dev-secret', 'calendar-state.' + encoded));
  if (!sig || sig.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(encoded)));
    return payload.exp > Math.floor(Date.now() / 1000);
  } catch (e) { return false; }
}

function calendarRedirectUri(url) {
  return url.origin + '/calendar/oauth';
}

async function handleCalendarConnect(request, env, url) {
  if (!calendarClientConfigured(env)) {
    return json({ error: 'the worker is missing GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET',
                  missing: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
                  redirect_uri: calendarRedirectUri(url),
                  tell_the_user: 'The calendar cannot be connected yet: the worker needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first, from an OAuth client whose redirect URI is ' + calendarRedirectUri(url) + '.' },
                503, env, request);
  }
  const consent = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  consent.searchParams.set('client_id', googleClient(env).id);
  consent.searchParams.set('redirect_uri', calendarRedirectUri(url));
  consent.searchParams.set('response_type', 'code');
  consent.searchParams.set('scope', CALENDAR_SCOPES);
  consent.searchParams.set('access_type', 'offline');
  consent.searchParams.set('prompt', 'consent select_account');   // always a refresh token, always a choice of account
  consent.searchParams.set('include_granted_scopes', 'true');
  consent.searchParams.set('state', await signCalendarState(env));
  return json({ ok: true, url: consent.toString(), redirect_uri: calendarRedirectUri(url) }, 200, env, request);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function calendarPage(title, bodyHtml, status) {
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(title) + '</title>' +
    '<body style="font-family:system-ui,sans-serif;background:#05080d;color:#cfe8ee;display:flex;min-height:100vh;' +
    'align-items:center;justify-content:center;margin:0;padding:16px"><div style="max-width:520px">' +
    '<h1 style="font-size:20px;color:#5ff">' + escapeHtml(title) + '</h1>' + bodyHtml + '</div></body>',
    { status: status || 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/* Where Google sends him back. Public by necessity — Google's redirect
   carries no token of ours — which is exactly why the signed state is
   checked before anything else is looked at. */
async function handleCalendarOAuth(request, env, url) {
  /* The same registered address serves YouTube (2.9.1): its state is signed
     with its own prefix, so a YouTube round trip is recognised here and
     handed over, and nobody has to add a second redirect URI in Google
     Cloud (a missing one is Google's "redirect_uri_mismatch"). */
  if (await verifyYoutubeState(env, url.searchParams.get('state') || '')) return handleYoutubeOAuth(request, env, url);
  if (url.searchParams.get('error')) {
    return calendarPage('Calendar not connected',
      '<p>Google said: ' + escapeHtml(url.searchParams.get('error')) + '. Nothing was changed.</p>', 400);
  }
  if (!(await verifyCalendarState(env, url.searchParams.get('state') || ''))) {
    return calendarPage('Calendar not connected',
      '<p>This link has expired, or was not started by your JARVIS. Ask him to connect the calendar again.</p>', 400);
  }
  const code = url.searchParams.get('code') || '';
  if (!code || !calendarClientConfigured(env)) {
    return calendarPage('Calendar not connected', '<p>Google did not send a sign-in code back. Nothing was changed.</p>', 400);
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: code,
      client_id: googleClient(env).id,
      client_secret: googleClient(env).secret,
      redirect_uri: calendarRedirectUri(url),
      grant_type: 'authorization_code'
    })
  });
  const data = await res.json().catch(() => ({}));
  /* Each way this last step fails has one fix, and it is a different one
     each time — so each is named, rather than one piece of advice that is
     right for only one of them. */
  if (!res.ok) {
    const why = String(data.error || ('HTTP ' + res.status));
    const fix = why === 'invalid_client'
      ? 'Google did not accept the worker\'s <code>GOOGLE_CLIENT_SECRET</code> for this client. In Cloudflare, enter it again: ' +
        'only the value, which starts <code>GOCSPX-</code>, exactly as Google Cloud shows it under Clients for this client ' +
        '(if you added a new secret there, it is the new one). Deploy, then connect again.'
      : why === 'redirect_uri_mismatch'
      ? 'The client in Google Cloud does not list this worker\'s address. Under Authorized redirect URIs, add exactly ' +
        '<code>' + escapeHtml(calendarRedirectUri(url)) + '</code>, then connect again.'
      : why === 'invalid_grant'
      ? 'This sign-in was already used or took too long. Ask JARVIS to connect the calendar again.'
      : 'Nothing was changed. Ask JARVIS to connect the calendar again.';
    return calendarPage('Calendar not connected',
      '<p>Google refused the last step (' + escapeHtml(why) + ').</p><p>' + fix + '</p>', 400);
  }
  if (!data.refresh_token) {
    return calendarPage('Calendar not connected',
      '<p>Google did not hand over a lasting permission. Remove JARVIS at myaccount.google.com/permissions ' +
      'and connect again.</p>', 400);
  }
  let account = null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(String(data.id_token || '').split('.')[1] || '')));
    account = claims.email || null;
  } catch (e) { /* no id_token: the account is named on the first read instead */ }

  if (!env.JARVIS_DB) {
    return calendarPage('Almost connected',
      '<p>Signed in as <b>' + escapeHtml(account || 'your Google account') + '</b>, but this worker has no database ' +
      'to keep the permission in. Set this as the <code>GOOGLE_REFRESH_TOKEN</code> secret:</p>' +
      '<p style="word-break:break-all;background:#0b1520;padding:8px"><code>' + escapeHtml(data.refresh_token) + '</code></p>');
  }
  await saveCalendar(env, { refresh_token: data.refresh_token, account: account, connected_at: new Date().toISOString() });
  return calendarPage('Calendar connected',
    '<p>JARVIS now reads and writes the Google Calendar of <b>' + escapeHtml(account || 'the account you chose') +
    '</b>. You can close this tab.</p>');
}

/* =====================================================================
   MUSIC ON YOUTUBE (2.9.0) — "let's put some music" plays his YouTube
   playlist named "jarvis" (ג'רוויס) from the first video.

   Spotify came first (2.8.0) and was dropped: since February 2026 its
   developer API needs a Premium account to exist at all. YouTube needs
   nothing new: the Google OAuth client the calendar already uses
   (GOOGLE_CLIENT_ID/SECRET) is asked for one more read-only permission,
   on its own connection, because a YouTube channel can belong to a
   different account (or a brand account) from the calendar.

   Two ways to know the playlist, in this order:
     1. JARVIS_PLAYLIST (or YOUTUBE_PLAYLIST) on the worker: a playlist
        link or its id. Needs no connection at all.
     2. "connect YouTube" once (POST /youtube/connect → Google consent →
        public GET /youtube/oauth): his playlists are read and the one
        named jarvis / ג'רוויס is found by name.
   The first video comes from the API (with his token, or YOUTUBE_API_KEY),
   else from the playlist page itself. The page opens
   watch?v=<first>&list=<id>&index=1, which YouTube plays from the start,
   in order. Refusals are coded, never 401 (the page reads 401 as its own
   session running out).
   ===================================================================== */
const YOUTUBE_SCOPES = 'openid email https://www.googleapis.com/auth/youtube.readonly';
const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';

/* Every way he might have spelled the name, with apostrophes, geresh,
   spaces and case taken out: "Jarvis", "JARVIS", "ג'רוויס", "ג׳רוויס",
   "גרוויס", "ג'וויס". */
const JARVIS_PLAYLIST_NAMES = ['jarvis', 'javis', 'jarviss', 'גרוויס', 'גוויס', 'גארוויס', 'גרביס', 'גארביס'];
function playlistKey(s) {
  return String(s || '').toLowerCase().replace(/["'`׳״’‘\s._-]+/g, '');
}
function playlistIdFrom(v) {
  const s = String(v || '').trim();
  const m = /[?&]list=([A-Za-z0-9_-]{10,64})/.exec(s) || /^([A-Za-z0-9_-]{10,64})$/.exec(s);
  return m ? m[1] : null;
}
/* The address Google sends him back to: the calendar's, which is already
   registered in the OAuth client. A callback arriving on /youtube/oauth
   (an older consent link) is answered there too. */
function youtubeRedirectUri(url) {
  return url.origin + '/calendar/oauth';
}
function youtubeCallbackUri(url) {
  return url.origin + (url.pathname.replace(/\/+$/, '') === '/youtube/oauth' ? '/youtube/oauth' : '/calendar/oauth');
}
function youtubeFail(env, request, status, code, error, tell, extra) {
  return json(Object.assign({ ok: false, code, error, tell_the_user: tell }, extra || {}), status, env, request);
}
function youtubeConfigured(env) {
  const c = googleClient(env);
  return !!((c.id && c.secret) || playlistIdFrom(env.JARVIS_PLAYLIST || env.YOUTUBE_PLAYLIST));
}

async function storedYoutube(env) {
  if (!env.JARVIS_DB) return null;
  try {
    await ensureSchema(env);
    const row = await env.JARVIS_DB.prepare("SELECT value FROM jarvis_meta WHERE key = 'youtube'").first();
    return row && row.value ? JSON.parse(row.value) : null;
  } catch (e) { return null; }
}
async function saveYoutube(env, value) {
  await ensureSchema(env);
  await env.JARVIS_DB.prepare(
    "INSERT INTO jarvis_meta (key, value) VALUES ('youtube', ?) " +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind(JSON.stringify(value)).run();
}

/* A fresh access token from the stored refresh token, or why there is none. */
async function youtubeAccess(env) {
  const stored = await storedYoutube(env);
  if (!stored || !stored.refresh_token) return { missing: true };
  const c = googleClient(env);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, refresh_token: stored.refresh_token, grant_type: 'refresh_token' })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    return { error: String(data.error_description || data.error || ('HTTP ' + res.status)), revoked: data.error === 'invalid_grant', badClient: data.error === 'invalid_client' };
  }
  return { token: data.access_token, stored };
}

async function youtubeApi(path, token, apiKey) {
  const u = YOUTUBE_API + path + (apiKey && !token ? (path.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(apiKey) : '');
  const res = await fetch(u, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}
/* Google's own words for "the YouTube Data API is not switched on in this
   project", which needs a different fix from everything else. */
function youtubeApiOff(r) {
  const e = r && r.data && r.data.error;
  const reason = e && Array.isArray(e.errors) && e.errors[0] && e.errors[0].reason;
  return r && r.status === 403 && (reason === 'accessNotConfigured' || /has not been used|is disabled|SERVICE_DISABLED/i.test(String((e && e.message) || '')));
}
function youtubeApiMessage(r) {
  const e = r && r.data && r.data.error;
  return String((e && e.message) || ('HTTP ' + (r && r.status))).slice(0, 200);
}

/* His playlists, looked through by name: an exact (normalised) match on the
   name asked for, else any of the spellings of jarvis, else one containing
   it. */
async function findYoutubePlaylist(token, name) {
  const want = playlistKey(name || 'jarvis');
  const wanted = new Set([want].concat(JARVIS_PLAYLIST_NAMES.includes(want) || !name ? JARVIS_PLAYLIST_NAMES : []));
  let exact = null, near = null, pageToken = '';
  for (let page = 0; page < 6; page++) {
    const r = await youtubeApi('/playlists?part=snippet,contentDetails&mine=true&maxResults=50' + (pageToken ? '&pageToken=' + pageToken : ''), token);
    if (!r.ok) return { error: r };
    for (const p of (r.data && r.data.items) || []) {
      const k = playlistKey(p.snippet && p.snippet.title);
      if (k === want) { exact = p; break; }
      if (!exact && wanted.has(k)) exact = p;
      if (!near && [...wanted].some(w => w && k.includes(w))) near = p;
    }
    if (exact && playlistKey(exact.snippet.title) === want) break;
    pageToken = r.data && r.data.nextPageToken;
    if (!pageToken) break;
  }
  const p = exact || near;
  if (!p) return { none: true };
  return { playlist: { id: p.id, title: (p.snippet && p.snippet.title) || name, count: p.contentDetails ? p.contentDetails.itemCount : null } };
}

/* The first video that can play: skips "Deleted video" / "Private video". */
async function firstYoutubeVideo(env, playlistId, token) {
  const key = String(env.YOUTUBE_API_KEY || env.GOOGLE_API_KEY || '').trim();
  if (token || key) {
    const r = await youtubeApi('/playlistItems?part=snippet,contentDetails&maxResults=10&playlistId=' + encodeURIComponent(playlistId), token, key);
    if (r.ok) {
      for (const it of (r.data && r.data.items) || []) {
        const vid = it.contentDetails && it.contentDetails.videoId;
        const title = String((it.snippet && it.snippet.title) || '');
        if (vid && !/^(deleted|private) video$/i.test(title)) return { videoId: vid, title };
      }
      return { empty: true };
    }
    if (youtubeApiOff(r)) return { apiOff: r };
  }
  /* No API at all: the playlist page carries its videos in its own data. */
  try {
    const res = await fetch('https://www.youtube.com/playlist?list=' + encodeURIComponent(playlistId) + '&hl=en',
                            { headers: { 'Accept-Language': 'en', 'User-Agent': 'Mozilla/5.0' } });
    const html = await res.text();
    const m = /"playlistVideoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/.exec(html) || /"videoId":"([A-Za-z0-9_-]{11})"/.exec(html);
    if (m) return { videoId: m[1], title: null };
  } catch (e) { /* the page will open the playlist itself */ }
  return { unknown: true };
}

/* POST /youtube/playlist { name?: 'jarvis' } → { ok, playlist, first, url } */
async function handleYoutubePlaylist(request, env) {
  const body = await request.json().catch(() => ({}));
  const name = String((body && body.name) || 'jarvis');
  let token = null, account = null, playlist = null;

  const fixedId = playlistIdFrom(env.JARVIS_PLAYLIST || env.YOUTUBE_PLAYLIST);
  if (fixedId) {
    playlist = { id: fixedId, title: name, count: null, from: 'JARVIS_PLAYLIST' };
    const got = await youtubeAccess(env).catch(() => ({}));
    if (got && got.token) { token = got.token; account = got.stored.account || null; }
  } else {
    const c = googleClient(env);
    if (!(c.id && c.secret)) {
      return youtubeFail(env, request, 503, 'youtube_missing', 'the worker has neither JARVIS_PLAYLIST nor GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET',
        'YouTube music is not set up on my server yet: it needs the Google sign-in keys, or the playlist link as JARVIS_PLAYLIST.',
        { missing: ['JARVIS_PLAYLIST', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] });
    }
    const got = await youtubeAccess(env);
    if (got.missing || got.revoked) {
      return youtubeFail(env, request, 409, 'youtube_not_connected', got.revoked ? 'the YouTube permission was withdrawn or has expired' : 'YouTube is not connected yet',
        got.revoked ? 'The YouTube connection has expired. I opened Google so you can approve it again, then ask for music again.'
                    : 'YouTube needs connecting once. I opened Google so you can approve it, then ask for music again.',
        { needs_connect: true });
    }
    if (got.error) {
      return youtubeFail(env, request, 502, got.badClient ? 'youtube_client' : 'youtube_down', 'Google sign-in failed: ' + got.error,
        got.badClient ? 'Google did not accept my sign-in keys. GOOGLE_CLIENT_SECRET on the server needs entering again.'
                      : 'Google did not let me sign in to YouTube just now.');
    }
    token = got.token; account = got.stored.account || null;
    const found = await findYoutubePlaylist(token, name);
    if (found.error) {
      if (youtubeApiOff(found.error)) {
        return youtubeFail(env, request, 502, 'youtube_api_disabled', 'YouTube Data API v3 is not enabled: ' + youtubeApiMessage(found.error),
          'The YouTube Data API is switched off in the Google Cloud project. Enable "YouTube Data API v3" there, then ask again.');
      }
      return youtubeFail(env, request, 502, 'youtube_down', 'YouTube answered: ' + youtubeApiMessage(found.error), 'YouTube did not give me your playlists just now.');
    }
    if (found.none) {
      return youtubeFail(env, request, 404, 'playlist_not_found', 'no playlist named "' + name + '" on ' + (account || 'this channel'),
        'I could not find a playlist called ' + name + ' on your YouTube' + (account ? ' (' + account + ')' : '') + '.', { account });
    }
    playlist = found.playlist;
  }

  const first = await firstYoutubeVideo(env, playlist.id, token);
  if (first.apiOff) {
    return youtubeFail(env, request, 502, 'youtube_api_disabled', 'YouTube Data API v3 is not enabled: ' + youtubeApiMessage(first.apiOff),
      'The YouTube Data API is switched off in the Google Cloud project. Enable "YouTube Data API v3" there, then ask again.', { playlist });
  }
  if (first.empty) {
    return youtubeFail(env, request, 404, 'playlist_empty', 'the playlist has no playable video', 'Your ' + playlist.title + ' playlist has no video I can play.', { playlist });
  }
  const url = first.videoId
    ? 'https://www.youtube.com/watch?v=' + first.videoId + '&list=' + encodeURIComponent(playlist.id) + '&index=1'
    : 'https://www.youtube.com/playlist?list=' + encodeURIComponent(playlist.id);
  return json({ ok: true, playlist, first: first.videoId ? { videoId: first.videoId, title: first.title } : null, url, account,
                plays_from_start: !!first.videoId }, 200, env, request);
}

/* The consent page: signed like the calendar's, with its own prefix. */
async function signYoutubeState(env) {
  const nonce = b64urlEncode(crypto.getRandomValues(new Uint8Array(12)));
  const encoded = b64urlEncode(new TextEncoder().encode(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + CALENDAR_STATE_TTL_SECONDS, n: nonce })));
  return encoded + '.' + b64urlEncode(await hmac(tokenSecret(env) || 'dev-secret', 'youtube-state.' + encoded));
}
async function verifyYoutubeState(env, state) {
  if (!state || state.indexOf('.') < 0) return false;
  const [encoded, sig] = state.split('.');
  const expected = b64urlEncode(await hmac(tokenSecret(env) || 'dev-secret', 'youtube-state.' + encoded));
  if (!sig || sig.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(encoded)));
    return payload.exp > Math.floor(Date.now() / 1000);
  } catch (e) { return false; }
}

async function handleYoutubeConnect(request, env, url) {
  const c = googleClient(env);
  if (!(c.id && c.secret)) {
    return youtubeFail(env, request, 503, 'youtube_missing', 'the worker is missing GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET',
      'YouTube cannot be connected yet: my server needs the Google sign-in keys first.', { missing: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], redirect_uri: youtubeRedirectUri(url) });
  }
  const consent = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  consent.searchParams.set('client_id', c.id);
  consent.searchParams.set('redirect_uri', youtubeRedirectUri(url));
  consent.searchParams.set('response_type', 'code');
  consent.searchParams.set('scope', YOUTUBE_SCOPES);
  consent.searchParams.set('access_type', 'offline');
  consent.searchParams.set('prompt', 'consent select_account');
  consent.searchParams.set('state', await signYoutubeState(env));
  return json({ ok: true, url: consent.toString(), redirect_uri: youtubeRedirectUri(url) }, 200, env, request);
}

async function handleYoutubeOAuth(request, env, url) {
  const page = (title, html, status) => calendarPage(title, html, status);
  if (url.searchParams.get('error')) {
    return page('YouTube not connected', '<p>Google said: ' + escapeHtml(url.searchParams.get('error')) + '. Nothing was changed.</p>', 400);
  }
  if (!(await verifyYoutubeState(env, url.searchParams.get('state') || ''))) {
    return page('YouTube not connected', '<p>This link has expired, or was not started by your JARVIS. Ask him to connect YouTube again.</p>', 400);
  }
  const code = url.searchParams.get('code') || '';
  const c = googleClient(env);
  if (!code || !(c.id && c.secret)) {
    return page('YouTube not connected', '<p>Google did not send a sign-in code back. Nothing was changed.</p>', 400);
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: c.id, client_secret: c.secret, redirect_uri: youtubeCallbackUri(url), grant_type: 'authorization_code' })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.refresh_token) {
    const why = String(data.error || (data.refresh_token ? '' : 'no lasting permission') || ('HTTP ' + res.status));
    const fix = why === 'invalid_client'
      ? 'Google did not accept the worker\'s <code>GOOGLE_CLIENT_SECRET</code>. Enter it again in Cloudflare, deploy, then connect again.'
      : why === 'redirect_uri_mismatch'
      ? 'The Google OAuth client does not list this address. In Google Cloud, Credentials, your OAuth client, Authorized redirect URIs, add exactly <code>' + escapeHtml(youtubeCallbackUri(url)) + '</code>, save, then connect again.'
      : why === 'invalid_grant'
      ? 'This sign-in was already used or took too long. Ask JARVIS to connect YouTube again.'
      : 'Remove JARVIS at myaccount.google.com/permissions and connect again.';
    return page('YouTube not connected', '<p>Google refused the last step (' + escapeHtml(why) + ').</p><p>' + fix + '</p>', 400);
  }
  let account = null;
  try {
    const ch = await youtubeApi('/channels?part=snippet&mine=true', data.access_token);
    if (ch.ok && ch.data && ch.data.items && ch.data.items[0]) account = ch.data.items[0].snippet.title || null;
    else if (youtubeApiOff(ch)) {
      if (env.JARVIS_DB) await saveYoutube(env, { refresh_token: data.refresh_token, account: null, connected_at: new Date().toISOString() });
      return page('Almost connected',
        '<p>Google approved, but the <b>YouTube Data API v3</b> is switched off in your Google Cloud project, so your playlists cannot be read yet.</p>' +
        '<p>In Google Cloud: APIs &amp; Services, Library, search "YouTube Data API v3", Enable. Then ask JARVIS for music again; there is no need to connect again.</p>');
    }
  } catch (e) { /* named on the first play instead */ }
  if (!env.JARVIS_DB) {
    return page('YouTube not connected', '<p>Signed in, but this worker has no database (JARVIS_DB) to keep the permission in.</p>', 500);
  }
  await saveYoutube(env, { refresh_token: data.refresh_token, account, connected_at: new Date().toISOString() });
  return page('YouTube connected',
    '<p>JARVIS now plays music from the YouTube channel <b>' + escapeHtml(account || 'you chose') +
    '</b>. You can close this tab and say "let\'s put some music".</p>');
}

/* =====================================================================
   THE OUTBOX — WhatsApp messages and phone calls, to him and only him

   Both go through CallMeBot, and both can only ever reach him: there is no
   recipient argument anywhere, so nothing JARVIS is told can turn either
   into a way of contacting somebody else.

     whatsapp  a WhatsApp message. Needs WHATSAPP_PHONE + CALLMEBOT_APIKEY.
     call      a Telegram voice call: a synthetic voice reads the text when
               he answers. Needs no key — only who to ring (CALL_USER, or
               WHATSAPP_PHONE when that is not set) and a one-time /start to
               @CallMeBot_txtbot in his Telegram.

   "Now" goes straight out. "At 4pm" is written to D1 and sent by the Cron
   Trigger, which Cloudflare runs whether his computer is on, off or in a
   drawer. D1 rather than KV: KV is eventually consistent, and a queue read
   in one place and rewritten in another loses the entry that arrived in
   between. Here every entry is its own row and a send is claimed with a
   conditional UPDATE, so two overlapping runs cannot both send it.
   ===================================================================== */

const WA_MAX_TEXT      = 1000;
const CALL_MAX_TEXT    = 256;                // CallMeBot cuts anything longer
const CALL_WAIT_MS     = 15000;              // how long the page waits on a call being placed
const WA_MAX_AHEAD_MS  = 366 * 86400000;
const WA_NOW_WINDOW_MS = 60 * 1000;          // this close to now just means now
const WA_PAST_GRACE_MS = 10 * 60 * 1000;     // a little in the past: send; more: a wrong date
const WA_LATE_MS       = 15 * 60 * 1000;     // later than this, it says it is late
const WA_MAX_TRIES     = 3;
const WA_STUCK_MS      = 10 * 60 * 1000;     // a claim this old died mid-send
const WA_CRON_FRESH_MS = 5 * 60 * 1000;
const WA_KEEP_MS       = 30 * 86400000;      // finished rows kept this long

function whatsAppPhone(env) { return normalizePhone(env.WHATSAPP_PHONE || ''); }
function whatsAppConfigured(env) { return !!(env.CALLMEBOT_APIKEY && whatsAppPhone(env)); }

/* Who a call rings: a Telegram @username, or a phone number with its
   country code. His WhatsApp number is the default, so calls work the moment
   that one secret exists. */
function callTarget(env) {
  const u = String(env.CALL_USER || '').trim();
  if (!u) return whatsAppPhone(env);
  if (/^@?[A-Za-z][A-Za-z0-9_]{4,31}$/.test(u)) return u.startsWith('@') ? u : '@' + u;
  return normalizePhone(u);
}
function callConfigured(env) { return !!callTarget(env); }
function maskTarget(t) { return !t ? null : t.startsWith('@') ? t : maskPhone(t); }

/* 0552813729, 055-281-3729, 972552813729, +972 55 281 3729 and
   00972552813729 are all the same phone. A leading single 0 is an Israeli
   local number. */
function normalizePhone(raw) {
  let d = String(raw || '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = '972' + d.slice(1);
  if (!/^\d{8,15}$/.test(d)) return '';
  return '+' + d;
}

function maskPhone(p) {
  if (!p) return null;
  return p.slice(0, 6) + '*'.repeat(Math.max(0, p.length - 10)) + p.slice(-4);
}

function validTimeZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; }
  catch (e) { return 'Asia/Jerusalem'; }
}

function tzOffsetMs(utcMs, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(utcMs));
  const g = type => +parts.find(p => p.type === type).value;
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/* A time with no zone on it is HIS wall-clock time, not the worker's. The
   worker runs in UTC, so reading "16:00" the default way would deliver the
   workout reminder at seven in the evening in summer. Done twice so a date
   on the far side of a clock change lands on the right hour. */
function wallTimeToUtc(y, mo, d, h, mi, se, tz) {
  const zone = validTimeZone(tz || 'Asia/Jerusalem');
  const guess = Date.UTC(y, mo - 1, d, h, mi, se);
  let at = guess - tzOffsetMs(guess, zone);
  at = guess - tzOffsetMs(at, zone);
  return at;
}

function parseSendAt(value, tz) {
  const s = String(value || '').trim();
  if (!s) return { at: null };
  if (/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(s)) {
    const at = Date.parse(s);
    return Number.isFinite(at) ? { at } : { error: 'could not read send_at: ' + s };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) return { error: 'send_at must be ISO 8601, e.g. 2026-09-23T16:00:00+03:00 — got: ' + s };
  const at = wallTimeToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0), tz);
  return Number.isFinite(at) ? { at } : { error: 'could not read send_at: ' + s };
}

function wallClock(ms, tz) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: validTimeZone(tz || 'Asia/Jerusalem'),
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  } catch (e) { return new Date(ms).toISOString().slice(11, 16); }
}

const hebrew = s => /[֐-׿]/.test(String(s || ''));
const plainText = body => String(body || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);

/* CallMeBot answers 200 with a sentence either way, so the sentence is
   read. Only a network failure, a 429 or a 5xx is worth trying again: a
   bad key will be exactly as bad in a minute, and retrying something that
   may in fact have gone out is how he gets the same reminder three times. */
async function callMeBot(env, text) {
  const url = 'https://api.callmebot.com/whatsapp.php' +
    '?phone=' + encodeURIComponent(whatsAppPhone(env)) +
    '&text=' + encodeURIComponent(text) +
    '&apikey=' + encodeURIComponent(String(env.CALLMEBOT_APIKEY).trim());
  let res, body = '';
  try {
    res = await fetch(url, { method: 'GET' });
    body = await res.text().catch(() => '');
  } catch (err) {
    return { ok: false, retry: true, detail: 'could not reach CallMeBot: ' + ((err && err.message) || err) };
  }
  const plain = plainText(body);
  if (res.status === 429 || res.status >= 500) {
    return { ok: false, retry: true, status: res.status, detail: plain || ('HTTP ' + res.status) };
  }
  const refused = !res.ok ||
    (/invalid|error|not allowed|blocked|paused|wrong|denied|not registered/i.test(plain) &&
     !/message (?:queued|sent)/i.test(plain));
  if (refused) return { ok: false, retry: false, status: res.status, detail: plain || ('HTTP ' + res.status) };
  return { ok: true, status: res.status, detail: plain };
}

/* A voice call through Telegram. The voice is picked from the text: a
   Hebrew sentence read by an English voice is noise. Standard voices only —
   CallMeBot does not take the premium ones. cc=missed leaves the text in
   Telegram if he does not pick up, so a missed call is not a lost one. */
function callVoice(text, env) {
  return hebrew(text) ? (env.CALL_VOICE_HE || 'he-IL-Standard-B') : (env.CALL_VOICE_EN || 'en-GB-Standard-B');
}
const CALL_NOT_AUTHORISED =
  'CallMeBot is not allowed to call you yet — open Telegram and send /start to @CallMeBot_txtbot, then try again.';

function readCallReply(status, body) {
  const plain = plainText(body);
  if (status === 429 || status >= 500) return { ok: false, retry: true, status, detail: plain || ('HTTP ' + status) };
  const authorised = /authori[sz]ation ok/i.test(plain);
  const notAuthorised = /not authori[sz]ed|authori[sz]ation (?:failed|error|denied|required)|\/start/i.test(plain) && !authorised;
  const refused = status < 200 || status >= 300 || notAuthorised ||
    (/invalid|error|blocked|denied|not found|wrong/i.test(plain) && !authorised);
  if (refused) {
    return { ok: false, retry: false, status, detail: plain || ('HTTP ' + status),
             tell_the_user: notAuthorised ? CALL_NOT_AUTHORISED : undefined };
  }
  return { ok: true, status, detail: plain };
}

/* The request stays open while the phone rings, which can be half a
   minute. The page is not made to sit through that: after CALL_WAIT_MS it is
   told the call is being placed, and the rest runs on in the background.
   Anything that fails fast — no authorisation, a bad number — comes back
   well inside that and is reported properly. The cron passes no wait: it has
   all the time it needs. */
async function callMeBotCall(env, text, waitMs) {
  const url = 'https://api.callmebot.com/start.php' +
    '?user=' + encodeURIComponent(callTarget(env)) +
    '&text=' + encodeURIComponent(text) +
    '&lang=' + encodeURIComponent(callVoice(text, env)) +
    '&rpt=2&cc=missed&timeout=30';
  const attempt = (async () => {
    let res, body = '';
    try {
      res = await fetch(url, { method: 'GET' });
      body = await res.text().catch(() => '');
    } catch (err) {
      return { ok: false, retry: true, detail: 'could not reach CallMeBot: ' + ((err && err.message) || err) };
    }
    return readCallReply(res.status, body);
  })();
  if (!waitMs) return attempt;
  let timer;
  const waited = new Promise(resolve => { timer = setTimeout(() => resolve(null), waitMs); });
  const first = await Promise.race([attempt, waited]);
  clearTimeout(timer);
  if (first) return first;
  return { ok: true, placing: true, detail: 'the call is being placed', rest: attempt };
}

/* One entry per kind of thing the outbox can send. Adding the next
   automation is a row here, not another copy of the queue. */
const CHANNELS = {
  whatsapp: {
    configured: whatsAppConfigured,
    maxText: WA_MAX_TEXT,
    to: env => maskPhone(whatsAppPhone(env)),
    send: (env, text) => callMeBot(env, text),
    late: (text, due) => '⏰ ' + due + ' · ' + text,
    notConfigured: 'WhatsApp is not set up on the worker yet — it needs the WHATSAPP_PHONE and CALLMEBOT_APIKEY secrets.',
    emptyText: 'text is required — ask him what the message should say'
  },
  call: {
    configured: callConfigured,
    maxText: CALL_MAX_TEXT,
    to: env => maskTarget(callTarget(env)),
    send: (env, text, waitMs) => callMeBotCall(env, text, waitMs),
    late: (text, due) => (hebrew(text) ? 'השיחה הזאת הייתה אמורה להגיע ב-' + due + '. ' : 'This call was due at ' + due + '. ') + text,
    notConfigured: 'Calls are not set up on the worker yet — it needs CALL_USER (a Telegram @username or phone number) or WHATSAPP_PHONE.',
    emptyText: 'text is required — ask him what the call should say'
  }
};

let schemaReady = null;
function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = env.JARVIS_DB;
      /* The queue began as WhatsApp's alone. Renamed in place, keeping
         whatever it holds, the first time a worker that knows about calls
         touches it. */
      const tables = await db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('whatsapp_queue', 'outbox')"
      ).all();
      const names = ((tables && tables.results) || []).map(r => r.name);
      if (names.includes('whatsapp_queue') && !names.includes('outbox')) {
        await db.prepare('ALTER TABLE whatsapp_queue RENAME TO outbox').run();
        await db.prepare("ALTER TABLE outbox ADD COLUMN channel TEXT NOT NULL DEFAULT 'whatsapp'").run();
      }
      await db.prepare(
        'CREATE TABLE IF NOT EXISTS outbox (' +
        " id TEXT PRIMARY KEY, channel TEXT NOT NULL DEFAULT 'whatsapp', text TEXT NOT NULL," +
        ' send_at INTEGER NOT NULL, tz TEXT, created INTEGER NOT NULL,' +
        " status TEXT NOT NULL DEFAULT 'pending', tries INTEGER NOT NULL DEFAULT 0," +
        ' claimed_at INTEGER, sent_at INTEGER, last_error TEXT)'
      ).run();
      await db.prepare(
        'CREATE TABLE IF NOT EXISTS jarvis_meta (key TEXT PRIMARY KEY, value TEXT)'
      ).run();
    })().catch(err => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

async function cronAlive(env) {
  try {
    await ensureSchema(env);
    const row = await env.JARVIS_DB.prepare("SELECT value FROM jarvis_meta WHERE key = 'cron_tick'").first();
    const tick = row ? parseInt(row.value, 10) : 0;
    return Date.now() - tick < WA_CRON_FRESH_MS;
  } catch (e) { return false; }
}

function outboxRow(r) {
  return {
    id: r.id,
    channel: r.channel || 'whatsapp',
    text: r.text,
    send_at: new Date(r.send_at).toISOString(),
    status: r.status,
    tries: r.tries || 0,
    sent_at: r.sent_at ? new Date(r.sent_at).toISOString() : null,
    last_error: r.last_error || null
  };
}

async function handleOutboxSend(request, env, ctx, channel) {
  const ch = CHANNELS[channel];
  if (!ch.configured(env)) {
    return json({ error: channel + ' not configured', tell_the_user: ch.notConfigured }, 503, env, request);
  }
  const body = await request.json().catch(() => ({}));
  const text = String((body && body.text) || '').trim();
  if (!text) return json({ error: ch.emptyText }, 400, env, request);
  if (text.length > ch.maxText) {
    return json({ error: 'too long: ' + text.length + ' characters, the limit is ' + ch.maxText }, 400, env, request);
  }
  const tz = validTimeZone(String((body && body.timeZone) || 'Asia/Jerusalem'));
  const parsed = parseSendAt(body && body.send_at, tz);
  if (parsed.error) return json({ error: parsed.error }, 400, env, request);

  const now = Date.now();
  const at = parsed.at;
  if (at !== null && at < now - WA_PAST_GRACE_MS) {
    return json({
      error: 'that time has already passed (' + new Date(at).toISOString() + ') — check the date',
      now: new Date(now).toISOString()
    }, 400, env, request);
  }
  if (at !== null && at > now + WA_MAX_AHEAD_MS) {
    return json({ error: 'that is more than a year ahead' }, 400, env, request);
  }

  if (at === null || at <= now + WA_NOW_WINDOW_MS) {
    const r = await ch.send(env, text, CALL_WAIT_MS);
    if (!r.ok) {
      return json({ error: channel + ' failed: ' + r.detail, status: r.status || null,
                    tell_the_user: r.tell_the_user }, 502, env, request);
    }
    if (r.rest) {
      const rest = r.rest.catch(() => null);
      if (ctx && ctx.waitUntil) ctx.waitUntil(rest);
    }
    const out = { ok: true, sent: true, channel, to: ch.to(env), provider_said: r.detail };
    if (r.placing) {
      out.placing = true;
      out.note = 'The call is being placed now and rings for about 30 seconds.';
    }
    return json(out, 200, env, request);
  }

  if (!env.JARVIS_DB) {
    return json({
      error: 'sending later needs the JARVIS_DB binding (a D1 database) on the worker',
      tell_the_user: 'I can do that right now, but not at a set time yet — the worker still needs its D1 database bound as JARVIS_DB, plus a Cron Trigger.'
    }, 503, env, request);
  }
  await ensureSchema(env);
  const id = (channel === 'call' ? 'call' : 'wa') + now.toString(36) + Math.random().toString(36).slice(2, 6);
  await env.JARVIS_DB.prepare(
    'INSERT INTO outbox (id, channel, text, send_at, tz, created) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, channel, text, at, tz, now).run();

  const cron = await cronAlive(env);
  const out = {
    ok: true, scheduled: true, id, channel,
    send_at: new Date(at).toISOString(),
    local_time: wallClock(at, tz),
    to: ch.to(env),
    cron_running: cron
  };
  if (!cron) {
    out.warning = 'Saved, but the worker\'s Cron Trigger has not run in the last few minutes, so this will NOT ' +
                  'go out until one is added (worker → Settings → Triggers → Cron Triggers → "* * * * *"). ' +
                  'Tell him that plainly instead of confirming the reminder.';
  }
  return json(out, 200, env, request);
}

async function handleOutboxList(request, env) {
  if (!env.JARVIS_DB) return json({ pending: [], recent: [], later_available: false }, 200, env, request);
  await ensureSchema(env);
  const db = env.JARVIS_DB;
  const pending = await db.prepare(
    "SELECT * FROM outbox WHERE status IN ('pending', 'sending') ORDER BY send_at LIMIT 50"
  ).all();
  const recent = await db.prepare(
    "SELECT * FROM outbox WHERE status IN ('sent', 'failed', 'cancelled') " +
    'ORDER BY COALESCE(sent_at, send_at) DESC LIMIT 10'
  ).all();
  return json({
    pending: ((pending && pending.results) || []).map(outboxRow),
    recent: ((recent && recent.results) || []).map(outboxRow),
    later_available: true,
    cron_running: await cronAlive(env)
  }, 200, env, request);
}

async function handleOutboxCancel(request, env) {
  if (!env.JARVIS_DB) return json({ error: 'nothing is scheduled: the worker has no JARVIS_DB' }, 503, env, request);
  await ensureSchema(env);
  const body = await request.json().catch(() => ({}));
  const id = String((body && body.id) || '').trim();
  if (!id) return json({ error: 'id is required — list what is scheduled first' }, 400, env, request);
  const db = env.JARVIS_DB;
  const r = await db.prepare(
    "UPDATE outbox SET status = 'cancelled' WHERE id = ? AND status = 'pending'"
  ).bind(id).run();
  if (r && r.meta && r.meta.changes === 1) return json({ ok: true, cancelled: id }, 200, env, request);
  const row = await db.prepare('SELECT status FROM outbox WHERE id = ?').bind(id).first();
  return json({
    error: row ? 'cannot cancel: that one is already ' + row.status : 'nothing scheduled with id ' + id
  }, row ? 409 : 404, env, request);
}

async function runOutbox(env) {
  if (!env.JARVIS_DB) return { skipped: 'no JARVIS_DB' };
  await ensureSchema(env);
  const db = env.JARVIS_DB;
  const now = Date.now();

  /* Written every run, so /health can tell a cron that is firing from one
     that was never added. */
  await db.prepare(
    "INSERT INTO jarvis_meta (key, value) VALUES ('cron_tick', ?) " +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind(String(now)).run();
  await db.prepare(
    "DELETE FROM outbox WHERE status IN ('sent', 'failed', 'cancelled') AND created < ?"
  ).bind(now - WA_KEEP_MS).run();

  await db.prepare(
    "UPDATE outbox SET status = 'pending' WHERE status = 'sending' AND claimed_at < ?"
  ).bind(now - WA_STUCK_MS).run();

  const due = await db.prepare(
    "SELECT * FROM outbox WHERE status = 'pending' AND send_at <= ? ORDER BY send_at LIMIT 20"
  ).bind(now).all();
  const report = { sent: 0, failed: 0, retrying: 0 };
  for (const row of ((due && due.results) || [])) {
    const ch = CHANNELS[row.channel || 'whatsapp'];
    if (!ch || !ch.configured(env)) {
      await db.prepare("UPDATE outbox SET status = 'failed', last_error = ? WHERE id = ? AND status = 'pending'")
        .bind(ch ? ch.notConfigured : 'unknown channel ' + row.channel, row.id).run();
      report.failed++;
      continue;
    }
    const claim = await db.prepare(
      "UPDATE outbox SET status = 'sending', claimed_at = ? WHERE id = ? AND status = 'pending'"
    ).bind(now, row.id).run();
    if (!claim || !claim.meta || claim.meta.changes !== 1) continue;   // another run took it

    /* A reminder that arrives hours late with no word about it reads as
       nonsense — "go to your workout" at nine at night. Say when it was for. */
    const late = now - row.send_at > WA_LATE_MS;
    const text = late ? ch.late(row.text, wallClock(row.send_at, row.tz)).slice(0, ch.maxText) : row.text;

    const r = await ch.send(env, text, 0);
    const tries = (row.tries || 0) + 1;
    if (r.ok) {
      await db.prepare(
        "UPDATE outbox SET status = 'sent', sent_at = ?, tries = ?, last_error = NULL WHERE id = ?"
      ).bind(Date.now(), tries, row.id).run();
      report.sent++;
    } else if (r.retry && tries < WA_MAX_TRIES) {
      await db.prepare(
        "UPDATE outbox SET status = 'pending', tries = ?, last_error = ? WHERE id = ?"
      ).bind(tries, r.detail, row.id).run();
      report.retrying++;
    } else {
      await db.prepare(
        "UPDATE outbox SET status = 'failed', tries = ?, last_error = ? WHERE id = ?"
      ).bind(tries, r.detail, row.id).run();
      report.failed++;
    }
  }
  return report;
}

/* =====================================================================
   AGENTS — JARVIS as supervisor, not sole worker

   Everything above this line is what JARVIS already was: one assistant,
   one system prompt, one big toolbelt, executed turn by turn wherever the
   turn happened to start (the page's tool loop, or a standing task).
   That did not change and does not go away — it is still exactly how a
   normal conversation runs.

   What this section adds is a REGISTRY of narrower personas on top of the
   same machinery: each one is a system prompt plus a permitted subset of
   the tools that already exist, given a name, a risk level and an explicit
   permission list. A "Research Agent" is not a new kind of thing running
   somewhere else — it is one more scoped call through runEngineChain,
   the same function handleMessages already uses, with search_web and
   read_page in its tool list and nothing else.

   Two places actually RUN an agent:
     - the page (jarvis-desktop/dist/index.html), for anything that needs a
       browser-native or OS-native tool (camera, screenshots, window
       management, the new workspace/system tools) or that is answering
       him directly in conversation, and
     - this worker's Cron Trigger, for agents whose whole job is reading
       the public web and the store on a schedule with nobody watching —
       Competitor Intelligence and News/Intelligence — the same pattern
       the WhatsApp outbox above already established: Cloudflare wakes the
       worker on a timer regardless of whether his computer is on.

   Nothing here can do what the underlying tool could not already do.
   Giving an agent shopify.write does not create a new way to write to
   Shopify — it grants use of the shopify_admin_query tool that already
   existed, gated exactly as it always was (see handleShopify above: a
   write needs allow_writes: true and is logged, not approved — a choice
   already made and shipped, not something this reopens). What IS new is
   filesystem/git access for the Coding Agent, which has no precedent
   here and is capability-gated and approval-gated from a standing start.
   ===================================================================== */

/* ---------------------------------------------------------------------
   BRAND_PROFILE — configurable, not hardcoded.

   Three layers, later wins: sensible defaults inferred from what is
   already configured (the Shopify store name, if there is exactly one) →
   the BRAND_PROFILE_JSON secret, for values set once at deploy time → a
   row in jarvis_meta, for values changed from the app without a redeploy.
   Every agent that writes brand-voiced copy reads this rather than having
   a voice baked into its own prompt, so changing the brand once changes
   every agent that speaks for it.
--------------------------------------------------------------------- */
const BRAND_PROFILE_DEFAULTS = {
  name: '', voice: '', audience: '', visual_identity: '', colors: [],
  typography: '', style: '', positioning: '', products: '',
  pricing_philosophy: '', words_to_use: [], words_to_avoid: []
};

function defaultBrandName(env) {
  const stores = shopifyStores(env);
  return stores.length === 1 ? stores[0].name : '';
}

async function getBrandProfile(env) {
  const base = Object.assign({}, BRAND_PROFILE_DEFAULTS, { name: defaultBrandName(env) });
  let fromSecret = {};
  if (env.BRAND_PROFILE_JSON) {
    try { fromSecret = JSON.parse(env.BRAND_PROFILE_JSON); } catch (e) { /* ignored: bad JSON, defaults stand */ }
  }
  let fromDb = {};
  if (env.JARVIS_DB) {
    try {
      await ensureAgentSchema(env);
      const row = await env.JARVIS_DB.prepare("SELECT value FROM jarvis_meta WHERE key = 'brand_profile'").first();
      if (row && row.value) fromDb = JSON.parse(row.value);
    } catch (e) { /* ignored: no DB, or nothing saved yet */ }
  }
  return Object.assign({}, base, fromSecret, fromDb);
}

async function setBrandProfile(env, patch) {
  await ensureAgentSchema(env);
  const current = await getBrandProfile(env);
  const next = Object.assign({}, current, patch || {});
  await env.JARVIS_DB.prepare(
    "INSERT INTO jarvis_meta (key, value) VALUES ('brand_profile', ?) " +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind(JSON.stringify(next)).run();
  return next;
}

/* ---------------------------------------------------------------------
   PERMISSIONS — capability strings, default deny.

   Every string an agent might be checked against is listed here, once,
   whether or not anything actually grants it — that list IS the
   documentation of what this system is capable of at all. Three of them
   (shell.execute, payments.read, payments.write) are listed and granted
   to nobody, on purpose: agentHasPermission refuses them outright, before
   it even looks at the registry, so a registry entry cannot hand them out
   by a future editing mistake. That is the literal meaning of "never
   allow this agent to independently perform destructive actions" and
   "never transfer money" — not a policy to remember, a branch that
   returns false no matter what the registry says.
--------------------------------------------------------------------- */
const PERMISSION_CAPABILITIES = [
  'internet.read', 'filesystem.read', 'filesystem.write',
  'git.read', 'git.write', 'shell.execute',
  'shopify.read', 'shopify.write',
  'calendar.read', 'calendar.write',
  'whatsapp.send', 'phone.call',
  'memory.read', 'memory.write',
  'system.read', 'agent.pause',
  'payments.read', 'payments.write', 'production.deploy'
];

/* Capabilities nothing may ever hold, whatever a registry entry says.
   shell.execute: no agent gets a raw shell — the Coding Agent gets scoped
   file and git operations instead, which covers everything the brief
   actually asks for ("read code, write code, work with git") without
   opening arbitrary command execution on his machine.
   payments.*, production.deploy: no integration for either exists, and
   none should be added under this project without a much more deliberate
   conversation than a registry edit. */
const NEVER_GRANTED = new Set(['shell.execute', 'payments.read', 'payments.write', 'production.deploy']);

/* Capabilities that need his sign-off before the action they gate runs,
   over and above the agent holding the permission at all. Deliberately
   NOT shopify.write, whatsapp.send or phone.call — those already shipped
   as log-gated rather than approval-gated (see the comment on handleShopify
   and the OUTBOX section above), and retrofitting an approval step onto a
   choice already made and already in use would change working behaviour
   under his feet. What is new here is filesystem.write and git.write: no
   prior version of this project could touch a file or a repository at
   all, so there is no existing behaviour to preserve, and giving an LLM
   that power without a checkpoint is not a corner to cut quietly. */
const APPROVAL_REQUIRED = new Set(['filesystem.write', 'git.write', 'agent.pause']);

function requiresApproval(capability) {
  return APPROVAL_REQUIRED.has(capability);
}

/* Whether AGENT may use CAPABILITY at all. Checked before every tool
   dispatch that maps to a permission-bearing tool (see the page's
   agentPermissionGuard, which calls this same table by fetching the
   registry — one source of truth, read in two runtimes). */
function agentHasPermission(agentId, capability) {
  if (NEVER_GRANTED.has(capability)) return false;
  const agent = AGENT_REGISTRY.find(a => a.id === agentId);
  if (!agent) return false;
  return !!(agent.permissions && agent.permissions[capability]);
}

/* ---------------------------------------------------------------------
   AGENT_REGISTRY — the nineteen personas, and JARVIS itself is not one of
   them: JARVIS is the supervisor that decides whether a request needs one
   of these at all, same as it always answered everything directly before
   this file existed. A registry entry is data, not code — description is
   the actual system-prompt text an agent runs with (prefixed with the
   brand profile where relevant), tools names the subset of the existing
   tool schemas it is handed, and permissions is checked before any tool
   whose name appears in TOOL_CAPABILITY below is allowed to run.

   riskLevel follows the brief's four bands (low/medium/high/critical);
   only 'coding' reaches high, because only it holds a capability
   (filesystem.write / git.write) this project has never granted before.
   Nothing here is critical, because nothing here is production.deploy,
   payments.*, or a delete of the store — none of those exist as tools
   at all yet, so no registry entry can reach for them. */
const AGENT_REGISTRY = [
  {
    id: 'research', name: 'Research Agent',
    description: 'General research and information gathering. Compare sources, track where each claim came from, and say plainly when the evidence is thin rather than presenting a guess as a fact. Structure the answer as findings, sources, a confidence level, the conclusions that actually follow, and what is still an open question.',
    capabilities: ['web search', 'source comparison', 'summarization'],
    tools: ['search_web', 'read_page'],
    permissions: { 'internet.read': true, 'memory.write': true },
    riskLevel: 'low', model: 'default', memoryNamespace: 'PROJECT_MEMORY',
    triggers: ['on_demand'], schedule: null
  },
  {
    id: 'competitor', name: 'Competitor Intelligence Agent',
    description: 'Monitor named ecommerce competitors: products, prices, discounts, promotions, new listings, positioning, and anything a storefront page says about shipping. Build a short profile per competitor and report only what actually changed since the last pass — a re-statement of everything unchanged is noise, not intelligence. Cannot see reviews or social activity that are not on the page itself.',
    capabilities: ['competitor tracking', 'change detection'],
    tools: ['search_web', 'read_page'],
    permissions: { 'internet.read': true, 'memory.write': true, 'memory.read': true },
    riskLevel: 'low', model: 'default', memoryNamespace: 'BUSINESS_MEMORY',
    triggers: ['on_demand', 'schedule'], schedule: { every: 'hours', hours: 24 }
  },
  {
    id: 'product', name: 'Product Development Agent',
    description: 'Help develop products and collections: ideas, specifications, variants, materials, naming, SKU suggestions, packaging concepts, and how a new product differs from what is already in the store. Ground every suggestion in the store’s actual catalog and in research already gathered — never propose a product as if the catalog were empty.',
    capabilities: ['product ideation', 'specification', 'differentiation analysis'],
    tools: ['search_web', 'read_page', 'shopify_admin_query'],
    permissions: { 'internet.read': true, 'shopify.read': true, 'memory.read': true },
    riskLevel: 'low', model: 'default', memoryNamespace: 'BUSINESS_MEMORY',
    triggers: ['on_demand'], schedule: null
  },
  {
    id: 'creative', name: 'Creative Director Agent',
    description: 'Own the creative direction of the brand: campaign concepts, visual concepts described in words, product-photography concepts, creative briefs, social concepts, and collection themes. Every idea must fit BRAND_PROFILE — its voice, its visual identity, its words to use and to avoid — rather than a generic ecommerce aesthetic.',
    capabilities: ['campaign concepts', 'visual direction', 'brand consistency'],
    tools: [],
    permissions: { 'memory.read': true },
    riskLevel: 'low', model: 'default', memoryNamespace: 'BRAND_MEMORY',
    triggers: ['on_demand'], schedule: null
  },
  {
    id: 'copywriter', name: 'Copywriter Agent',
    description: 'Write all brand copy: product descriptions, headlines, landing pages, ads, emails, SMS, WhatsApp messages, Instagram captions, TikTok scripts, campaign copy. Follow BRAND_PROFILE’s voice and word lists exactly. Produces text only — it does not send anything itself; sending is the Personal Assistant’s or JARVIS’s own tool, kept separate so a copy draft can never become an outgoing message without somebody choosing to send it.',
    capabilities: ['product copy', 'ad copy', 'email/SMS copy', 'social captions'],
    tools: [],
    permissions: { 'memory.read': true },
    riskLevel: 'low', model: 'default', memoryNamespace: 'BRAND_MEMORY',
    triggers: ['on_demand'], schedule: null
  },
  {
    id: 'store', name: 'Store Manager Agent',
    description: 'Inspect and manage the Shopify store: products, inventory, orders, pricing, discounts, collections, product status. Reads by default. A write is still possible through shopify_admin_query exactly as it always was — the caller states allow_writes: true and it is logged, not held for approval, which is the existing design this project already shipped and this agent does not change.',
    capabilities: ['product management', 'order inspection', 'store health'],
    tools: ['shopify_admin_query'],
    permissions: { 'shopify.read': true, 'shopify.write': true, 'memory.write': true },
    riskLevel: 'medium', model: 'default', memoryNamespace: 'BUSINESS_MEMORY',
    triggers: ['on_demand'], schedule: null
  },
  {
    id: 'inventory', name: 'Inventory Agent',
    description: 'Monitor inventory and demand from the store’s own data: current stock, sales velocity, low stock, out of stock, slow-moving products, seasonal patterns. Cannot see supplier lead times or reorder rules that are not recorded in Shopify — say so rather than inventing a number.',
    capabilities: ['stock monitoring', 'demand tracking', 'anomaly flags'],
    tools: ['shopify_admin_query'],
    permissions: { 'shopify.read': true, 'memory.write': true },
    riskLevel: 'low', model: 'default', memoryNamespace: 'BUSINESS_MEMORY',
    triggers: ['on_demand', 'schedule'], schedule: { every: 'hours', hours: 24 }
  },
  {
    id: 'analytics', name: 'Analytics Agent',
    description: 'Analyze ecommerce performance from Shopify order and product data: revenue, order count, average order value, product performance, returns. Actively flag a meaningful change against the recent baseline rather than only reporting a number. No ad-platform or web-analytics integration exists, so conversion rate, traffic, cart abandonment and CAC/ROAS are out of reach until one is connected — say that plainly instead of estimating them.',
    capabilities: ['revenue analysis', 'anomaly detection', 'product performance'],
    tools: ['shopify_admin_query', 'search_web'],
    permissions: { 'shopify.read': true, 'internet.read': true, 'memory.write': true },
    riskLevel: 'low', model: 'default', memoryNamespace: 'BUSINESS_MEMORY',
    triggers: ['on_demand', 'schedule'], schedule: { every: 'hours', hours: 24 }
  },
  {
    id: 'marketing', name: 'Marketing Agent',
    description: 'Plan marketing strategy: campaign ideas, audience segmentation, a marketing calendar (using the same Google Calendar the Personal Assistant uses), creative briefs, experiment proposals, and after-the-fact performance analysis from whatever Analytics has. May recommend a budget change. Must never spend money or launch a paid campaign itself — there is no tool that could do either, by design.',
    capabilities: ['campaign planning', 'audience segmentation', 'marketing calendar'],
    tools: ['search_web', 'get_calendar_events', 'create_calendar_event'],
    permissions: { 'internet.read': true, 'calendar.read': true, 'calendar.write': true, 'memory.read': true },
    riskLevel: 'medium', model: 'default', memoryNamespace: 'BUSINESS_MEMORY',
    triggers: ['on_demand'], schedule: null
  },
  {
    id: 'social', name: 'Social Media Agent',
    description: 'Plan social content: a content calendar, post ideas, reel/TikTok concepts, stories, captions, hashtags where they genuinely fit. Works from what the Creative Director and Copywriter produce rather than writing final copy itself. Does not post anything — no platform-posting tool exists.',
    capabilities: ['content calendar', 'post concepts', 'campaign coordination'],
    tools: ['get_calendar_events', 'create_calendar_event'],
    permissions: { 'calendar.read': true, 'calendar.write': true, 'memory.read': true },
    riskLevel: 'low', model: 'default', memoryNamespace: 'BRAND_MEMORY',
    triggers: ['on_demand'], schedule: null
  },
  {
    id: 'finance', name: 'Finance Agent',
    description: 'Analyze the business financially from Shopify data alone: revenue, product-level margin where cost is recorded, returns, contribution by product. Strictly READ ONLY — there is no payments tool, no way to move money, and none should be built for this agent; it explains numbers, it never changes them.',
    capabilities: ['revenue analysis', 'margin analysis', 'profitability by product'],
    tools: ['shopify_admin_query'],
    permissions: { 'shopify.read': true, 'memory.read': true },
    riskLevel: 'low', model: 'default', memoryNamespace: 'BUSINESS_MEMORY',
    triggers: ['on_demand'], schedule: null
  },
  {
    id: 'support', name: 'Customer Support Agent',
    description: 'Handle order, shipping, return and product questions using Shopify order lookup and whatever is on the store’s own pages. If it cannot resolve something confidently, it says so and hands the conversation back to JARVIS/him rather than guessing at a policy. No refund, credit or cancellation tool exists for it to misuse — those stay human decisions.',
    capabilities: ['order lookup', 'FAQ', 'escalation'],
    tools: ['shopify_admin_query', 'read_page'],
    permissions: { 'shopify.read': true, 'internet.read': true },
    riskLevel: 'low', model: 'default', memoryNamespace: 'AGENT_MEMORY',
    triggers: ['on_demand'], schedule: null
  },
  {
    id: 'coding', name: 'Coding Agent',
    description: 'Read, analyze and write code inside a workspace folder set aside for it, and work with git there — status, diff, log, add, commit. It has no shell and cannot run arbitrary commands; workspace_git and workspace_write_file are the whole of what it can do to a filesystem, and both are confined to that one folder. A write never reaches production on its own: implement, then it says what it changed and why, then he approves.',
    capabilities: ['read code', 'write code', 'git status/diff/log/commit', 'propose changes'],
    tools: ['workspace_read_file', 'workspace_write_file', 'workspace_list_dir', 'workspace_git', 'run_code'],
    permissions: { 'filesystem.read': true, 'filesystem.write': true, 'git.read': true, 'git.write': true },
    riskLevel: 'high', model: 'default', memoryNamespace: 'PROJECT_MEMORY',
    triggers: ['on_demand'], schedule: null
  },
  {
    id: 'system', name: 'System Monitor Agent',
    description: 'Monitor the computer JARVIS is running on: CPU, RAM, disk. Reports a threshold breach (CPU_HIGH, MEMORY_HIGH, DISK_LOW) as an event rather than a running dashboard nobody is watching. Cannot see GPU load, Docker, or anything outside this one process’s view of the machine — those need OS access this app does not have.',
    capabilities: ['CPU/RAM/disk monitoring', 'threshold events'],
    tools: ['system_metrics'],
    permissions: { 'system.read': true, 'memory.write': true },
    riskLevel: 'low', model: 'default', memoryNamespace: 'EVENT_MEMORY',
    triggers: ['schedule'], schedule: { every: 'minutes', minutes: 15 }
  },
  {
    id: 'security', name: 'Security Agent',
    description: 'Watch for an agent acting outside the permission it was given — read AGENT_MEMORY/the action log for a denied-permission attempt — and for an unfamiliar process in the list system_metrics/list_processes can see. May raise an alert and may pause another agent (flip its own registry entry’s paused flag, which every agent checks before it runs) but cannot stop a process, delete a file, or touch the network. It has no capability that could do any of those things.',
    capabilities: ['permission-violation detection', 'process anomaly flags', 'agent pause'],
    tools: ['list_processes'],
    permissions: { 'system.read': true, 'agent.pause': true, 'memory.read': true },
    riskLevel: 'medium', model: 'default', memoryNamespace: 'EVENT_MEMORY',
    triggers: ['on_demand', 'schedule'], schedule: { every: 'minutes', minutes: 30 }
  },
  {
    id: 'qa', name: 'QA / Website Testing Agent',
    description: 'Test the storefront the way read_page and qa_check_page allow: fetch a page, report its status code, look for broken internal links and images, and check that a product page’s markup contains an add-to-cart control. This is NOT browser automation — it cannot click, fill a form, add anything to a real cart, or run a checkout, and it says so rather than reporting a pass on a step it never performed. Real end-to-end checkout testing needs a browser-automation integration this project does not have.',
    capabilities: ['broken-link/image scan', 'page reachability', 'markup-level checks'],
    tools: ['read_page', 'qa_check_page'],
    permissions: { 'internet.read': true, 'memory.write': true },
    riskLevel: 'low', model: 'default', memoryNamespace: 'PROJECT_MEMORY',
    triggers: ['on_demand'], schedule: null
  },
  {
    id: 'personal', name: 'Personal Assistant Agent',
    description: 'Handle his personal productivity: standing tasks, calendar, reminders, project tracking. Reads and writes only PERSONAL_MEMORY and PROJECT_MEMORY by default — it does not read BUSINESS_MEMORY or BRAND_MEMORY unless a request explicitly asks it to cross into one of them.',
    capabilities: ['tasks', 'reminders', 'calendar', 'project tracking'],
    tools: ['get_calendar_events', 'create_calendar_event', 'remember_to_do', 'list_standing_tasks', 'cancel_standing_task', 'remember'],
    permissions: { 'calendar.read': true, 'calendar.write': true, 'memory.read': true, 'memory.write': true },
    riskLevel: 'low', model: 'default', memoryNamespace: 'PERSONAL_MEMORY',
    triggers: ['on_demand'], schedule: null
  },
  {
    id: 'news', name: 'News / Intelligence Agent',
    description: 'Watch topics relevant to him and the business — ecommerce, AI, the categories this store sells in, competitors, tools — and produce ONE short digest, not a stream of articles. Silence is the correct output on a day nothing worth his attention happened.',
    capabilities: ['topic monitoring', 'digest synthesis'],
    tools: ['search_web'],
    permissions: { 'internet.read': true, 'memory.write': true },
    riskLevel: 'low', model: 'default', memoryNamespace: 'EVENT_MEMORY',
    triggers: ['schedule'], schedule: { every: 'daily', time: '07:00' }
  },
  {
    id: 'memory', name: 'Memory Agent',
    description: 'Long-term structured memory for every other agent and for JARVIS itself. Not a conversation partner — it is the retrieval and relevance layer behind USER_MEMORY, BUSINESS_MEMORY, BRAND_MEMORY, PROJECT_MEMORY, AGENT_MEMORY, DECISION_MEMORY and EVENT_MEMORY. Retrieves only what a request is actually relevant to rather than dumping everything stored, and never writes to BRAND_MEMORY or DECISION_MEMORY on another agent’s behalf — those two are written only by an agent whose own registry entry names that namespace, or by him directly.',
    capabilities: ['structured storage', 'relevance-scoped retrieval'],
    tools: [],
    permissions: { 'memory.read': true, 'memory.write': true },
    riskLevel: 'low', model: 'default', memoryNamespace: 'AGENT_MEMORY',
    triggers: ['on_demand'], schedule: null
  }
];

/* The memory namespaces named above, listed once so a caller can validate
   against something rather than a namespace string nobody enumerated. */
const MEMORY_NAMESPACES = [
  'USER_MEMORY', 'BUSINESS_MEMORY', 'BRAND_MEMORY', 'PROJECT_MEMORY',
  'AGENT_MEMORY', 'DECISION_MEMORY', 'EVENT_MEMORY', 'PERSONAL_MEMORY'
];

/* Which capability a given tool name actually exercises. Used by the page
   before it dispatches a tool call on an agent's behalf, and mirrored here
   so a worker-run agent (competitor, news, and anything the scheduler
   fires) is checked the identical way — one table, read from both runtimes,
   rather than a rule restated twice and eventually disagreeing. */
const TOOL_CAPABILITY = {
  search_web: 'internet.read', read_page: 'internet.read', qa_check_page: 'internet.read',
  shopify_admin_query: 'shopify.read',   // upgraded to shopify.write below when the call is a mutation
  get_calendar_events: 'calendar.read', create_calendar_event: 'calendar.write',
  send_whatsapp: 'whatsapp.send', call_me: 'phone.call',
  workspace_read_file: 'filesystem.read', workspace_write_file: 'filesystem.write',
  workspace_list_dir: 'filesystem.read',
  workspace_git: 'git.read',             // upgraded to git.write below for a mutating git action
  system_metrics: 'system.read', list_processes: 'system.read',
  remember: 'memory.write', remember_to_do: 'memory.write',
  list_standing_tasks: 'memory.read', cancel_standing_task: 'memory.write'
};
const GIT_WRITE_ACTIONS = new Set(['add', 'commit']);

/* The one place that decides whether AGENT may make THIS call. Returns
   {allowed, capability, needsApproval} rather than a bare boolean, because
   the caller has three different things to do with those three facts:
   refuse it, run it, or hold it for handleApprovalRequest. */
function checkToolPermission(agentId, toolName, input) {
  let capability = TOOL_CAPABILITY[toolName];
  if (!capability) return { allowed: true, capability: null, needsApproval: false }; // an unlisted tool carries no capability gate (e.g. run_code, already its own sandbox)
  if (toolName === 'shopify_admin_query' && containsMutation(String((input && input.query) || ''))) {
    capability = 'shopify.write';
  }
  if (toolName === 'workspace_git' && GIT_WRITE_ACTIONS.has(String((input && input.action) || ''))) {
    capability = 'git.write';
  }
  const allowed = agentHasPermission(agentId, capability);
  return { allowed, capability, needsApproval: allowed && requiresApproval(capability) };
}

/* ---------------------------------------------------------------------
   D1 SCHEMA — approvals, events, memory, agent schedule state. A second
   ensureSchema rather than folding into the outbox's, so a worker running
   only the WhatsApp features (JARVIS_DB set, none of this touched) never
   pays for tables it does not use, and so a mistake here cannot block the
   outbox's own migration, which is load-bearing for a feature already in
   his hands. */
let agentSchemaReady = null;
function ensureAgentSchema(env) {
  if (!env.JARVIS_DB) return Promise.reject(new Error('no JARVIS_DB binding'));
  if (!agentSchemaReady) {
    agentSchemaReady = (async () => {
      const db = env.JARVIS_DB;
      await db.prepare(
        'CREATE TABLE IF NOT EXISTS approvals (' +
        ' id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, action TEXT NOT NULL,' +
        ' capability TEXT NOT NULL, risk_level TEXT NOT NULL, payload TEXT,' +
        " status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL," +
        ' decided_at INTEGER, decided_by TEXT, note TEXT)'
      ).run();
      await db.prepare(
        'CREATE TABLE IF NOT EXISTS events (' +
        ' id TEXT PRIMARY KEY, type TEXT NOT NULL, source_agent TEXT,' +
        " priority TEXT NOT NULL DEFAULT 'low', data TEXT, created_at INTEGER NOT NULL," +
        ' handled INTEGER NOT NULL DEFAULT 0)'
      ).run();
      await db.prepare(
        'CREATE TABLE IF NOT EXISTS agent_memory (' +
        ' id TEXT PRIMARY KEY, namespace TEXT NOT NULL, agent_id TEXT,' +
        ' text TEXT NOT NULL, created_at INTEGER NOT NULL)'
      ).run();
      await db.prepare(
        'CREATE TABLE IF NOT EXISTS agent_runs (' +
        ' agent_id TEXT PRIMARY KEY, last_run_at INTEGER, last_ok INTEGER,' +
        ' last_summary TEXT, paused INTEGER NOT NULL DEFAULT 0)'
      ).run();
    })().catch(err => { agentSchemaReady = null; throw err; });
  }
  return agentSchemaReady;
}

function newId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------------------------------------------------------------------
   EVENT BUS — durable, because nobody may be looking when an event fires
   (AGENT_STARTED/COMPLETED/FAILED, LOW_STOCK, PRICE_CHANGE, SECURITY_ALERT,
   and the rest of the vocabulary in the brief). Polled through GET
   /agent/events rather than pushed — the same shape the outbox already
   uses for "at 4pm" — because a Worker has nothing resembling a standing
   connection to the page to push through.
--------------------------------------------------------------------- */
async function logEvent(env, { type, source, priority, data }) {
  if (!env.JARVIS_DB) return null; // events are a convenience, not a dependency — never block an agent on this
  try {
    await ensureAgentSchema(env);
    const id = newId('e');
    await env.JARVIS_DB.prepare(
      'INSERT INTO events (id, type, source_agent, priority, data, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, type, source || null, priority || 'low', JSON.stringify(data || {}), Date.now()).run();
    return id;
  } catch (e) { return null; }
}

async function handleEventsRecent(request, env, url) {
  if (!env.JARVIS_DB) return json({ events: [] }, 200, env, request);
  await ensureAgentSchema(env);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
  const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;
  const rows = await env.JARVIS_DB.prepare(
    'SELECT * FROM events WHERE created_at > ? ORDER BY created_at DESC LIMIT ?'
  ).bind(since, limit).all();
  const events = ((rows && rows.results) || []).map(r => ({
    id: r.id, type: r.type, source: r.source_agent, priority: r.priority,
    data: JSON.parse(r.data || '{}'), at: new Date(r.created_at).toISOString()
  }));
  return json({ events }, 200, env, request);
}

/* ---------------------------------------------------------------------
   APPROVALS — the queue a HIGH-risk action is held in until he decides.
   Only reached for a capability requiresApproval() names; everything else
   an agent is permitted to do simply runs, exactly as every existing tool
   already did before this file existed.
--------------------------------------------------------------------- */
async function handleApprovalRequest(request, env) {
  await ensureAgentSchema(env);
  const body = await request.json().catch(() => ({}));
  const agentId = String((body && body.agent_id) || '');
  const action = String((body && body.action) || '');
  if (!agentId || !action) return json({ error: 'agent_id and action are required' }, 400, env, request);
  const capability = String((body && body.capability) || '');
  const check = agentHasPermission(agentId, capability);
  if (!check) {
    return json({ error: 'agent "' + agentId + '" does not hold "' + capability + '" — nothing was queued' }, 403, env, request);
  }
  const id = newId('ap');
  await env.JARVIS_DB.prepare(
    'INSERT INTO approvals (id, agent_id, action, capability, risk_level, payload, status, created_at) ' +
    "VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)"
  ).bind(id, agentId, action, capability, String((body && body.risk_level) || 'high'),
         JSON.stringify((body && body.payload) || {}), Date.now()).run();
  await logEvent(env, { type: 'APPROVAL_REQUIRED', source: agentId, priority: 'high', data: { id, action, capability } });
  return json({ ok: true, id, status: 'pending' }, 200, env, request);
}

async function handleApprovalList(request, env, url) {
  await ensureAgentSchema(env);
  const status = url.searchParams.get('status') || 'pending';
  const rows = await env.JARVIS_DB.prepare(
    status === 'all'
      ? 'SELECT * FROM approvals ORDER BY created_at DESC LIMIT 100'
      : 'SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC LIMIT 100'
  ).bind(...(status === 'all' ? [] : [status])).all();
  const approvals = ((rows && rows.results) || []).map(r => ({
    id: r.id, agent_id: r.agent_id, action: r.action, capability: r.capability,
    risk_level: r.risk_level, payload: JSON.parse(r.payload || '{}'), status: r.status,
    created_at: new Date(r.created_at).toISOString(),
    decided_at: r.decided_at ? new Date(r.decided_at).toISOString() : null
  }));
  return json({ approvals }, 200, env, request);
}

async function handleApprovalDecide(request, env) {
  await ensureAgentSchema(env);
  const body = await request.json().catch(() => ({}));
  const id = String((body && body.id) || '');
  const approve = !!(body && body.approve);
  if (!id) return json({ error: 'id is required' }, 400, env, request);
  const row = await env.JARVIS_DB.prepare('SELECT * FROM approvals WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'no such approval' }, 404, env, request);
  if (row.status !== 'pending') return json({ error: 'already ' + row.status }, 400, env, request);
  const status = approve ? 'approved' : 'rejected';
  await env.JARVIS_DB.prepare(
    'UPDATE approvals SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?'
  ).bind(status, Date.now(), 'user', id).run();
  await logEvent(env, { type: approve ? 'APPROVAL_GRANTED' : 'APPROVAL_REJECTED', source: row.agent_id, priority: 'low', data: { id } });
  return json({ ok: true, id, status }, 200, env, request);
}

/* ---------------------------------------------------------------------
   MEMORY — one store behind two entry points. The page's existing
   `remember` tool already persists to localStorage under five categories
   (pinned/about/preferences/projects/open_loops); this does not replace
   that — a worker-run agent (competitor, news) has no localStorage to
   write to at all, so it needs a server-side home for the same idea, and
   the page mirrors every remember call here too so BUSINESS_MEMORY written
   from the desktop and BUSINESS_MEMORY written by a 3am competitor scan
   land in the one place either can read back from.
--------------------------------------------------------------------- */
async function handleMemoryWrite(request, env) {
  await ensureAgentSchema(env);
  const body = await request.json().catch(() => ({}));
  const namespace = String((body && body.namespace) || '');
  const text = String((body && body.text) || '').trim();
  if (!MEMORY_NAMESPACES.includes(namespace)) {
    return json({ error: 'unknown namespace. one of: ' + MEMORY_NAMESPACES.join(', ') }, 400, env, request);
  }
  if (!text) return json({ error: 'no text' }, 400, env, request);
  const id = newId('m');
  await env.JARVIS_DB.prepare(
    'INSERT INTO agent_memory (id, namespace, agent_id, text, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, namespace, (body && body.agent_id) || null, text.slice(0, 2000), Date.now()).run();
  return json({ ok: true, id }, 200, env, request);
}

async function handleMemoryRead(request, env, url) {
  await ensureAgentSchema(env);
  const namespace = url.searchParams.get('namespace') || '';
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10) || 20));
  if (namespace && !MEMORY_NAMESPACES.includes(namespace)) {
    return json({ error: 'unknown namespace. one of: ' + MEMORY_NAMESPACES.join(', ') }, 400, env, request);
  }
  const rows = namespace
    ? await env.JARVIS_DB.prepare('SELECT * FROM agent_memory WHERE namespace = ? ORDER BY created_at DESC LIMIT ?').bind(namespace, limit).all()
    : await env.JARVIS_DB.prepare('SELECT * FROM agent_memory ORDER BY created_at DESC LIMIT ?').bind(limit).all();
  const memories = ((rows && rows.results) || []).map(r => ({
    id: r.id, namespace: r.namespace, agent_id: r.agent_id, text: r.text,
    at: new Date(r.created_at).toISOString()
  }));
  return json({ memories }, 200, env, request);
}

/* ---------------------------------------------------------------------
   THE REGISTRY, SERVED — one source of truth (this array) reflected to
   the page, plus each agent's live status folded in from agent_runs so
   "what's happening right now" (the brief's own phrase) has an answer:
   whether it is paused, when it last ran, whether that run was clean.
--------------------------------------------------------------------- */
async function handleAgentsList(request, env) {
  let runs = {};
  if (env.JARVIS_DB) {
    try {
      await ensureAgentSchema(env);
      const rows = await env.JARVIS_DB.prepare('SELECT * FROM agent_runs').all();
      for (const r of ((rows && rows.results) || [])) runs[r.agent_id] = r;
    } catch (e) { /* status is a courtesy; the registry itself never depends on it */ }
  }
  const brand = await getBrandProfile(env);
  const agents = AGENT_REGISTRY.map(a => {
    const run = runs[a.id];
    return Object.assign({}, a, {
      paused: !!(run && run.paused),
      lastRunAt: run && run.last_run_at ? new Date(run.last_run_at).toISOString() : null,
      lastOk: run ? !!run.last_ok : null,
      lastSummary: (run && run.last_summary) || null
    });
  });
  return json({ agents, brand, never_granted: [...NEVER_GRANTED], capabilities: PERMISSION_CAPABILITIES }, 200, env, request);
}

async function handleBrandProfile(request, env) {
  if (request.method === 'GET') return json({ brand: await getBrandProfile(env) }, 200, env, request);
  const body = await request.json().catch(() => ({}));
  const next = await setBrandProfile(env, body || {});
  return json({ ok: true, brand: next }, 200, env, request);
}

async function recordAgentRun(env, agentId, ok, summary) {
  if (!env.JARVIS_DB) return;
  try {
    await ensureAgentSchema(env);
    await env.JARVIS_DB.prepare(
      'INSERT INTO agent_runs (agent_id, last_run_at, last_ok, last_summary, paused) VALUES (?, ?, ?, ?, 0) ' +
      'ON CONFLICT(agent_id) DO UPDATE SET last_run_at = excluded.last_run_at, last_ok = excluded.last_ok, last_summary = excluded.last_summary'
    ).bind(agentId, Date.now(), ok ? 1 : 0, String(summary || '').slice(0, 500)).run();
  } catch (e) { /* status is a courtesy */ }
}

async function handleAgentPause(request, env) {
  await ensureAgentSchema(env);
  const body = await request.json().catch(() => ({}));
  const agentId = String((body && body.agent_id) || '');
  const requestedBy = String((body && body.requested_by) || 'user');
  if (!AGENT_REGISTRY.find(a => a.id === agentId)) return json({ error: 'no such agent' }, 404, env, request);
  /* The Security Agent is the one caller that is not him: it holds
     agent.pause and nothing above already grants that to anyone else, so
     this is the one place agentHasPermission is actually consulted for a
     capability being SPENT rather than a tool being run. */
  if (requestedBy !== 'user' && !agentHasPermission(requestedBy, 'agent.pause')) {
    return json({ error: '"' + requestedBy + '" does not hold agent.pause' }, 403, env, request);
  }
  const paused = !!(body && body.paused);
  await env.JARVIS_DB.prepare(
    'INSERT INTO agent_runs (agent_id, paused) VALUES (?, ?) ' +
    'ON CONFLICT(agent_id) DO UPDATE SET paused = excluded.paused'
  ).bind(agentId, paused ? 1 : 0).run();
  await logEvent(env, { type: paused ? 'AGENT_PAUSED' : 'AGENT_RESUMED', source: requestedBy, priority: 'medium', data: { agent_id: agentId } });
  return json({ ok: true, agent_id: agentId, paused }, 200, env, request);
}

async function agentIsPaused(env, agentId) {
  if (!env.JARVIS_DB) return false;
  try {
    await ensureAgentSchema(env);
    const row = await env.JARVIS_DB.prepare('SELECT paused FROM agent_runs WHERE agent_id = ?').bind(agentId).first();
    return !!(row && row.paused);
  } catch (e) { return false; }
}

/* ---------------------------------------------------------------------
   MODEL ROUTER — a thin layer over the engine chain that already exists.
   Nothing here replaces engineChain's own fallback/cooldown logic; it only
   picks which configured engine tries FIRST for a given agent, when an
   opinion has actually been configured. With nothing set, routing is a
   no-op and every agent sees the exact chain handleMessages always used.

   AGENT_MODEL_PREFERENCE is an optional secret: a JSON object mapping an
   agent id to a substring of the engine label it should prefer, e.g.
   {"coding":"anthropic","copywriter":"workers-ai"}. This project has no
   real cost/latency numbers to route on — inventing them would be exactly
   the kind of fabrication the brief warns against — so the router exposes
   the hook and lets him fill in an opinion instead of manufacturing one. */
function pickChainForAgent(env, agentId) {
  const chain = engineChain(env);
  let prefs = {};
  if (env.AGENT_MODEL_PREFERENCE) {
    try { prefs = JSON.parse(env.AGENT_MODEL_PREFERENCE); } catch (e) { /* bad JSON: no preference */ }
  }
  const want = prefs[agentId];
  if (!want) return chain;
  const preferred = chain.filter(e => e.label.includes(want) || e.vendor === want);
  if (!preferred.length) return chain;
  return preferred.concat(chain.filter(e => preferred.indexOf(e) < 0));
}

/* ---------------------------------------------------------------------
   THE WORKER'S OWN TINY TOOL LOOP — for the two agents that must run with
   nobody watching (competitor, news) and anything else fired from the Cron
   Trigger. This is deliberately much smaller than the page's askJarvis
   loop: three tools, because a scheduled agent has no camera, no Shopify
   write path offered to it here (store/inventory/analytics running
   ON-DEMAND go through the page instead, which already has the real
   shopify_admin_query tool and its whole dispatch table — duplicating that
   here for a case that already works would be exactly the "second system"
   the brief says not to build).
--------------------------------------------------------------------- */
const WORKER_AGENT_TOOLS = {
  search_web: {
    name: 'search_web',
    description: 'Search the web for current information. Returns up to eight results: title, url, snippet.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  },
  read_page: {
    name: 'read_page',
    description: 'Fetch one public web page and return its readable text and title.',
    input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }
  },
  remember: {
    name: 'remember',
    description: 'Save one short, self-contained fact worth keeping, in your own memory namespace.',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
  },
  /* Read-only in practice, not just in description: checkToolPermission
     upgrades this to shopify.write the moment the query is a mutation
     (containsMutation, the exact same check handleShopify uses), and
     neither agent that gets this tool server-side (analytics, inventory)
     holds shopify.write — so a scheduled run cannot change the store no
     matter what it asks for, before dispatchWorkerTool's body is ever
     reached. */
  shopify_admin_query: {
    name: 'shopify_admin_query',
    description: 'Run a read-only Shopify Admin GraphQL query against the configured store. Pass store_name only if more than one store is configured.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        variables: { type: 'object' },
        store_name: { type: 'string' }
      },
      required: ['query']
    }
  }
};

const BRAND_AWARE_AGENTS = new Set(['creative', 'copywriter', 'social', 'marketing', 'product']);

/* The persona's system prompt: its own registry description, with
   BRAND_PROFILE folded in for the agents whose job is speaking for the
   brand. Every other agent gets its description alone — a Finance Agent
   does not need to know the brand's preferred adjectives. */
function buildAgentSystemPrompt(agent, brand) {
  let prompt = 'You are the ' + agent.name + ', one specialist persona inside J.A.R.V.I.S. ' +
    'Stay inside the role and the tools described below; nothing else has been offered to you, ' +
    'and asking for something outside them will simply fail.\n\n' + agent.description;
  if (BRAND_AWARE_AGENTS.has(agent.id) && brand) {
    const lines = Object.entries(brand)
      .filter(([, v]) => v && (!Array.isArray(v) || v.length))
      .map(([k, v]) => '- ' + k + ': ' + (Array.isArray(v) ? v.join(', ') : v));
    if (lines.length) prompt += '\n\nBRAND_PROFILE (speak consistently with this):\n' + lines.join('\n');
  }
  return prompt;
}

async function dispatchWorkerTool(env, agent, name, input) {
  const check = checkToolPermission(agent.id, name, input);
  if (!check.allowed) return { error: agent.id + ' does not hold the "' + (check.capability || name) + '" permission needed for ' + name };
  if (name === 'search_web') return (await searchCore(String((input && input.query) || ''))).body;
  if (name === 'read_page') return (await fetchPageCore(input && input.url)).body;
  if (name === 'remember') {
    await ensureAgentSchema(env);
    const id = newId('m');
    await env.JARVIS_DB.prepare(
      'INSERT INTO agent_memory (id, namespace, agent_id, text, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, agent.memoryNamespace, agent.id, String((input && input.text) || '').slice(0, 2000), Date.now()).run();
    return { ok: true, id };
  }
  if (name === 'shopify_admin_query') {
    const stores = shopifyStores(env);
    if (!stores.length) return { error: 'shopify not configured' };
    const target = findStore(env, input && input.store_name);
    if (!target) {
      return {
        error: (input && input.store_name)
          ? 'no store named "' + input.store_name + '". Configured: ' + stores.map(s => s.name).join(', ')
          : 'more than one store is configured; pass store_name. Configured: ' + stores.map(s => s.name).join(', ')
      };
    }
    const result = await shopifyGraphQL(target, String((input && input.query) || ''), (input && input.variables) || {});
    return result.data;
  }
  return { error: 'unknown tool: ' + name };
}

const AGENT_MAX_TOOL_ROUNDS = 6;

/* One full turn for AGENTID, run entirely inside the worker: no page, no
   camera, no OS. Reuses runEngineChain — the exact fallback/cooldown logic
   handleMessages already relies on — so a scheduled agent gets the same
   resilience an ordinary chat message gets, not a thinner copy of it. */
async function runAgentInWorker(env, agentId, userText) {
  const agent = AGENT_REGISTRY.find(a => a.id === agentId);
  if (!agent) throw new Error('no such agent: ' + agentId);
  if (await agentIsPaused(env, agentId)) return { text: '(paused — the Security Agent or he paused this one; skipped)', rounds: 0, paused: true };

  const brand = await getBrandProfile(env);
  const system = buildAgentSystemPrompt(agent, brand);
  const tools = (agent.tools || []).filter(name => WORKER_AGENT_TOOLS[name]).map(name => WORKER_AGENT_TOOLS[name]);
  if (agentHasPermission(agentId, 'memory.write') && !tools.some(tl => tl.name === 'remember')) {
    tools.push(WORKER_AGENT_TOOLS.remember);
  }

  const chain = pickChainForAgent(env, agentId);
  const internalRequest = new Request('https://internal.jarvis.worker/agent-run');
  let messages = [{ role: 'user', content: userText }];
  let lastText = '';
  for (let round = 0; round < AGENT_MAX_TOOL_ROUNDS; round++) {
    const body = { model: 'claude', max_tokens: 1200, system: system, messages: messages };
    if (tools.length) body.tools = tools;
    const res = await runEngineChain(chain, body, env, internalRequest, null);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error((errData && errData.error) || ('agent run failed: ' + res.status));
    }
    const data = await res.json();
    const textBlocks = (data.content || []).filter(b => b.type === 'text').map(b => b.text);
    if (textBlocks.length) lastText = textBlocks.join('\n');
    if (data.stop_reason !== 'tool_use') return { text: lastText, rounds: round + 1 };

    const toolUse = (data.content || []).filter(b => b.type === 'tool_use');
    messages = messages.concat([{ role: 'assistant', content: data.content }]);
    const results = [];
    for (const tu of toolUse) {
      const payload = await dispatchWorkerTool(env, agent, tu.name, tu.input);
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(payload) });
    }
    messages = messages.concat([{ role: 'user', content: results }]);
  }
  return { text: lastText, rounds: AGENT_MAX_TOOL_ROUNDS, truncated: true };
}

/* ---------------------------------------------------------------------
   PER-AGENT CONFIG — "monitor these 15 competitors every 24 hours" needs
   somewhere to put the fifteen URLs. jarvis_meta again, keyed per agent,
   so it survives a redeploy without becoming a secret (it is not one) and
   without a schema change every time a new agent needs its own settings.
--------------------------------------------------------------------- */
async function getAgentConfig(env, agentId) {
  if (!env.JARVIS_DB) return {};
  try {
    await ensureAgentSchema(env);
    const row = await env.JARVIS_DB.prepare('SELECT value FROM jarvis_meta WHERE key = ?').bind('agent_config_' + agentId).first();
    return row && row.value ? JSON.parse(row.value) : {};
  } catch (e) { return {}; }
}
async function setAgentConfig(env, agentId, patch) {
  await ensureAgentSchema(env);
  const current = await getAgentConfig(env, agentId);
  const next = Object.assign({}, current, patch || {});
  await env.JARVIS_DB.prepare(
    'INSERT INTO jarvis_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind('agent_config_' + agentId, JSON.stringify(next)).run();
  return next;
}
async function handleAgentConfig(request, env, url) {
  let agentId = url.searchParams.get('agent_id') || '';
  let body = null;
  if (request.method !== 'GET') {
    body = await request.json().catch(() => ({}));
    agentId = agentId || String((body && body.agent_id) || '');
  }
  if (!agentId || !AGENT_REGISTRY.find(a => a.id === agentId)) return json({ error: 'unknown agent_id' }, 400, env, request);
  if (request.method === 'GET') return json({ agent_id: agentId, config: await getAgentConfig(env, agentId) }, 200, env, request);
  const next = await setAgentConfig(env, agentId, (body && body.config) || {});
  return json({ ok: true, agent_id: agentId, config: next }, 200, env, request);
}

/* ---------------------------------------------------------------------
   SCHEDULER — the same idea as the outbox's Cron Trigger, generalised: a
   registry entry names its OWN schedule (§10: "do not hardcode schedules
   into agent logic" — dueAgents reads agent.schedule generically, it never
   special-cases an agent id to decide timing), an optional override in
   jarvis_meta lets it change without a redeploy, and agent_runs records
   when each one last fired so the next tick knows whether it is due.
--------------------------------------------------------------------- */
function scheduleWindowMs(schedule) {
  if (!schedule) return null;
  if (schedule.every === 'hours') return (schedule.hours || 1) * 3600000;
  if (schedule.every === 'minutes') return (schedule.minutes || 15) * 60000;
  return null; // 'daily' is handled by dailyIsDue below, on a wall-clock boundary rather than an interval
}

function dailyIsDue(schedule, lastRunAt, now) {
  const parts = String((schedule && schedule.time) || '00:00').split(':');
  const hh = parseInt(parts[0], 10) || 0, mm = parseInt(parts[1], 10) || 0;
  const boundary = new Date(now);
  boundary.setUTCHours(hh, mm, 0, 0);
  let dueBoundary = boundary.getTime();
  if (dueBoundary > now) dueBoundary -= 24 * 3600000; // today's slot has not arrived — yesterday's already has
  return !lastRunAt || lastRunAt < dueBoundary;
}

async function getScheduleOverrides(env) {
  if (!env.JARVIS_DB) return {};
  try {
    await ensureAgentSchema(env);
    const row = await env.JARVIS_DB.prepare("SELECT value FROM jarvis_meta WHERE key = 'agent_schedule_overrides'").first();
    return row && row.value ? JSON.parse(row.value) : {};
  } catch (e) { return {}; }
}

async function dueAgents(env, now) {
  now = now || Date.now();
  const scheduled = AGENT_REGISTRY.filter(a => (a.triggers || []).includes('schedule') && a.schedule);
  if (!scheduled.length || !env.JARVIS_DB) return [];
  await ensureAgentSchema(env);
  const overrides = await getScheduleOverrides(env);
  const rows = await env.JARVIS_DB.prepare('SELECT * FROM agent_runs').all();
  const runs = {};
  for (const r of ((rows && rows.results) || [])) runs[r.agent_id] = r;
  const due = [];
  for (const agent of scheduled) {
    const run = runs[agent.id];
    if (run && run.paused) continue;
    const schedule = (overrides && overrides[agent.id]) || agent.schedule;
    const lastRunAt = run ? run.last_run_at : null;
    const windowMs = scheduleWindowMs(schedule);
    const isDue = windowMs !== null
      ? (!lastRunAt || now - lastRunAt >= windowMs)
      : (schedule.every === 'daily' && dailyIsDue(schedule, lastRunAt, now));
    if (isDue) due.push(agent);
  }
  return due;
}

/* Competitor and news were the first two wired to run server-side — the
   whole-public-web agents, needing nothing the worker did not already
   have. Analytics and Inventory join them here: their tool
   (shopify_admin_query) reaches the worker's own dispatchWorkerTool,
   which is READ-ONLY for both in practice, not just in description —
   checkToolPermission upgrades a mutating query to shopify.write and
   refuses it before dispatch ever runs, and neither agent's registry
   entry holds that permission. So this is not a second path to writing
   the store; the only path to that stays exactly where it was, on the
   page, gated by shopify.write and logged. Store Manager itself is NOT
   added here on purpose: it DOES hold shopify.write, and a store manager
   running unattended on a timer is a different, much bigger decision than
   giving two read-only reporting agents a schedule. */
const SERVER_RUNNABLE_SCHEDULED_AGENTS = new Set(['competitor', 'news', 'analytics', 'inventory']);

async function runScheduledAgent(env, agentId) {
  if (!SERVER_RUNNABLE_SCHEDULED_AGENTS.has(agentId)) {
    return { ok: false, agentId, error: 'this agent has no worker-side runner yet — it runs on demand from the app instead' };
  }
  const config = await getAgentConfig(env, agentId);
  let prompt;
  if (agentId === 'competitor') {
    const urls = Array.isArray(config.urls) ? config.urls.filter(Boolean) : [];
    if (!urls.length) {
      return { ok: false, agentId, error: 'no competitors configured — POST /agents/config?agent_id=competitor with {"config":{"urls":["https://..."]}}' };
    }
    prompt = 'Check each of these competitor pages and report ONLY what changed since your last note in your ' +
             'own memory (call remember to check nothing — you cannot read memory back yet, so rely on what ' +
             'the page says now and note anything worth tracking for next time): ' + urls.join(', ');
  } else if (agentId === 'news') {
    const topics = Array.isArray(config.topics) && config.topics.length ? config.topics : ['ecommerce', 'AI'];
    prompt = 'Produce one short digest for these topics, today only: ' + topics.join(', ') +
             '. If nothing meets the bar today, say so in one line rather than padding it out.';
  } else if (agentId === 'analytics' || agentId === 'inventory') {
    /* store_name is optional config (POST /agents/config?agent_id=analytics
       with {"config":{"store_name":"..."}}) — needed only when more than
       one store is configured; shopify_admin_query itself says so plainly
       if it turns out to be ambiguous and none was given. */
    const storeNote = config.store_name ? (' Use store_name "' + config.store_name + '" if the tool asks for one.') : '';
    prompt = (agentId === 'analytics'
      ? 'Using shopify_admin_query (read-only), look at recent orders and product performance.'
      : 'Using shopify_admin_query (read-only), check current inventory levels and recent sales velocity.')
      + storeNote + ' Flag anything that looks like a meaningful change; if nothing does, say so in one line.';
  } else {
    return { ok: false, agentId, error: 'no prompt defined for this scheduled agent' };
  }
  try {
    const result = await runAgentInWorker(env, agentId, prompt);
    await recordAgentRun(env, agentId, true, result.text);
    await logEvent(env, { type: 'AGENT_COMPLETED', source: agentId, priority: 'low', data: { summary: (result.text || '').slice(0, 300) } });
    return { ok: true, agentId, summary: result.text };
  } catch (err) {
    const why = String((err && err.message) || err);
    await recordAgentRun(env, agentId, false, why);
    await logEvent(env, { type: 'AGENT_FAILED', source: agentId, priority: 'high', data: { error: why } });
    return { ok: false, agentId, error: why };
  }
}

/* ---------------------------------------------------------------------
   THE DAILY SUMMARY (§11) — built from what actually happened (events,
   pending approvals), sent through the outbox exactly like any other
   WhatsApp message, once a day, only once, and only if WhatsApp is
   configured at all. "Nothing needed your attention" is a real, honest
   answer on a quiet day — it is not padded into content for its own sake.
--------------------------------------------------------------------- */
async function maybeSendDailySummary(env, now) {
  if (!env.JARVIS_DB) return;
  const ch = CHANNELS.whatsapp;
  if (!ch.configured(env)) return; // nowhere to send it — nothing to build
  await ensureAgentSchema(env);
  const dayKey = new Date(now).toISOString().slice(0, 10);
  const sentRow = await env.JARVIS_DB.prepare("SELECT value FROM jarvis_meta WHERE key = 'daily_summary_date'").first();
  if (sentRow && sentRow.value === dayKey) return; // already sent today

  const timeRow = await env.JARVIS_DB.prepare("SELECT value FROM jarvis_meta WHERE key = 'daily_summary_time'").first();
  const parts = String((timeRow && timeRow.value) || '07:00').split(':');
  const boundary = new Date(now);
  boundary.setUTCHours(parseInt(parts[0], 10) || 7, parseInt(parts[1], 10) || 0, 0, 0);
  if (now < boundary.getTime()) return; // not time yet today

  const since = now - 24 * 3600000;
  const evRows = await env.JARVIS_DB.prepare(
    'SELECT * FROM events WHERE created_at > ? ORDER BY created_at DESC LIMIT 100'
  ).bind(since).all();
  const events = ((evRows && evRows.results) || []).map(r => ({
    type: r.type, source: r.source_agent, priority: r.priority
  }));
  const notable = events.filter(e => e.priority === 'high' || e.priority === 'medium');
  const pendingRows = await env.JARVIS_DB.prepare("SELECT id FROM approvals WHERE status = 'pending'").all();
  const pendingCount = ((pendingRows && pendingRows.results) || []).length;

  const lines = [];
  if (!notable.length && !pendingCount) {
    lines.push('Good morning. Nothing needed your attention in the last day.');
  } else {
    lines.push('Good morning. Since yesterday:');
    for (const e of notable.slice(0, 8)) {
      lines.push('- ' + e.type.replace(/_/g, ' ').toLowerCase() + (e.source ? ' (' + e.source + ')' : ''));
    }
    if (pendingCount) lines.push('- ' + pendingCount + ' action' + (pendingCount === 1 ? '' : 's') + ' waiting on your approval.');
  }
  const text = lines.join('\n').slice(0, ch.maxText);

  await env.JARVIS_DB.prepare(
    'INSERT INTO outbox (id, channel, text, send_at, created, status, tries) VALUES (?, ?, ?, ?, ?, ?, 0)'
  ).bind(newId('wa'), 'whatsapp', text, now, now, 'pending').run();
  await env.JARVIS_DB.prepare(
    "INSERT INTO jarvis_meta (key, value) VALUES ('daily_summary_date', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).bind(dayKey).run();
}

/* ---------------------------------------------------------------------
   QA / WEBSITE TESTING — markup-level checks only, built on the exact same
   fetchPageCore read_page already uses. Deliberately NOT browser
   automation: nothing here clicks anything, fills a form, or touches a
   real cart. "Broken" means missing or empty in the HTML itself, which is
   what can honestly be checked without a browser to drive — a link whose
   TARGET happens to 404 would need one more fetch per link, which for a
   normal product page is dozens of requests for a feature nobody asked to
   be that heavy, so it is left undone rather than faked. */
async function qaCheckPage(rawUrl) {
  const result = await fetchPageCore(rawUrl);
  if (!result.body || !result.body.ok) return result; // forward the fetch failure as-is

  const html = result.rawHtml || '';
  const imgTags = [...html.matchAll(/<img\b[^>]*>/gi)];
  const brokenImages = imgTags.filter(m => !/\bsrc\s*=\s*["'][^"']+["']/i.test(m[0])).length;
  const linkTags = [...html.matchAll(/<a\b[^>]*>/gi)];
  const brokenLinks = linkTags.filter(m => {
    const href = /\bhref\s*=\s*["']([^"']*)["']/i.exec(m[0]);
    return !href || !href[1].trim() || href[1].trim() === '#';
  }).length;
  const hasAddToCart = /add[\s_-]?to[\s_-]?cart/i.test(html) || /name=["']add["']/i.test(html);

  return {
    status: 200,
    body: {
      ok: true,
      url: result.body.url,
      title: result.body.title,
      images_found: imgTags.length, broken_images: brokenImages,
      links_found: linkTags.length, broken_links: brokenLinks,
      has_add_to_cart_control: hasAddToCart,
      note: 'Markup-level check only: nothing was clicked, no form was submitted, no cart was used. ' +
            '"broken" means missing or empty in the HTML, not confirmed unreachable.'
    }
  };
}

async function handleQaCheck(request, env) {
  const body = await request.json().catch(() => ({}));
  const result = await qaCheckPage(body && body.url);
  return json(result.body, result.status, env, request);
}

/* Called from the Cron Trigger, right beside runOutbox. Capped at three
   agent runs per tick: each one is a full model call (and possibly several
   rounds of one), and a Cron Trigger's CPU budget is not unlimited — three
   is generous for the two agents that exist today and safe headroom for
   more without one slow tick starving the outbox it runs alongside. */
async function runDueAgents(env) {
  if (!env.JARVIS_DB) return { ran: [] };
  const due = await dueAgents(env, Date.now());
  const ran = [];
  for (const agent of due.slice(0, 3)) {
    ran.push(await runScheduledAgent(env, agent.id));
  }
  await maybeSendDailySummary(env, Date.now());
  return { ran };
}
