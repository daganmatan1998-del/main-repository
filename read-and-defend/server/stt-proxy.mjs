/**
 * Speech-to-text proxy for Read & Defend.
 *
 * The browser never holds an API key. It POSTs a short audio clip here; this
 * server forwards it to a transcription API with the key from the
 * environment and returns only the text.
 *
 *   OPENAI_API_KEY=sk-... node server/stt-proxy.mjs
 *
 * Environment
 *   OPENAI_API_KEY   required — without it /health reports 503 and the game
 *                    tells the grown-up that the speech server is not set up
 *   STT_MODEL        default "gpt-4o-mini-transcribe" (Hebrew + English);
 *                    "whisper-1" also works
 *   PORT             default 8787 (vite dev proxies /api here)
 *   ALLOWED_ORIGIN   CORS origin, default "*"; set it to your site's origin
 *                    in production (and capacitor://localhost /
 *                    https://localhost for the mobile apps)
 *   SERVE_DIST       "1" to also serve ../dist (single-process deploy)
 *
 * Privacy: audio is held in memory for one request and never written to
 * disk or logged; transcripts are not logged. The target word is NEVER sent
 * to the transcription service as a hint — that would let the recogniser
 * "hear" the right answer and defeat the point of reading.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 2 * 1024 * 1024; // ~1 minute of opus; a reading is a few seconds
const RATE_PER_MIN = 40;

const LANGS = { 'he-IL': 'he', he: 'he', 'en-US': 'en', 'en-GB': 'en', en: 'en' };

/** Build the request handler. Dependencies are injectable for tests. */
export function createHandler({ apiKey, model = 'gpt-4o-mini-transcribe', fetchImpl = fetch, allowedOrigin = '*', distDir = null } = {}) {
  const hits = new Map();

  const cors = (req, res) => {
    const origin = req.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin === '*' ? '*' : allowedOrigin.split(',').map((s) => s.trim()).includes(origin) ? origin : 'null');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  };
  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const limited = (ip) => {
    const now = Date.now();
    const list = (hits.get(ip) ?? []).filter((t) => now - t < 60000);
    list.push(now);
    hits.set(ip, list);
    return list.length > RATE_PER_MIN;
  };

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    if (url.pathname.startsWith('/api/stt')) {
      cors(req, res);
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      if (url.pathname === '/api/stt/health') {
        return apiKey ? json(res, 200, { ok: true, model }) : json(res, 503, { ok: false, error: 'OPENAI_API_KEY is not set' });
      }
      if (url.pathname !== '/api/stt' || req.method !== 'POST') return json(res, 404, { error: 'not found' });
      if (!apiKey) return json(res, 503, { error: 'not configured' });
      if (limited(req.socket.remoteAddress ?? '?')) return json(res, 429, { error: 'too many requests' });

      const lang = LANGS[url.searchParams.get('lang') ?? ''];
      if (!lang) return json(res, 400, { error: 'unsupported language' });

      const chunks = [];
      let size = 0;
      try {
        for await (const c of req) {
          size += c.length;
          if (size > MAX_BYTES) return json(res, 413, { error: 'audio too long' });
          chunks.push(c);
        }
      } catch {
        return json(res, 400, { error: 'bad body' });
      }
      if (!size) return json(res, 400, { error: 'empty audio' });

      const type = (req.headers['content-type'] ?? 'audio/webm').split(';')[0];
      const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : 'webm';
      const form = new FormData();
      form.append('file', new Blob([Buffer.concat(chunks)], { type }), `reading.${ext}`);
      form.append('model', model);
      form.append('language', lang);
      form.append('response_format', 'json');
      form.append('temperature', '0');
      chunks.length = 0;

      try {
        const r = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
        });
        if (!r.ok) return json(res, 502, { error: `transcription failed (${r.status})` });
        const body = await r.json();
        return json(res, 200, { text: String(body.text ?? '').trim() });
      } catch {
        return json(res, 502, { error: 'transcription service unreachable' });
      }
    }

    if (distDir) {
      let file = path.join(distDir, decodeURIComponent(url.pathname));
      if (!file.startsWith(distDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(distDir, 'index.html');
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
      return;
    }
    json(res, 404, { error: 'not found' });
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const handler = createHandler({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.STT_MODEL || undefined,
    allowedOrigin: process.env.ALLOWED_ORIGIN || '*',
    distDir: process.env.SERVE_DIST === '1' ? path.resolve(here, '../dist') : null,
  });
  const port = Number(process.env.PORT || 8787);
  http.createServer(handler).listen(port, () => {
    console.log(`Read & Defend speech proxy on :${port} — ${process.env.OPENAI_API_KEY ? 'configured' : 'NOT configured (set OPENAI_API_KEY)'}`);
  });
}
