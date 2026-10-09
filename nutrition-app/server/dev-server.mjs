// Local development server: serves www/ and /api/* on one origin, using the
// exact same handler as the Cloudflare Worker.
//
//   ANTHROPIC_API_KEY=sk-ant-... npm run dev      (or put it in .env)
//   open http://localhost:8787

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', 'www');
const envFile = path.resolve(here, '..', '.env');

if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// Apply the same global headers (CSP etc.) as production, from www/_headers.
const GLOBAL_HEADERS = {};
const headersFile = path.join(root, '_headers');
if (existsSync(headersFile)) {
  let inGlobal = false;
  for (const line of readFileSync(headersFile, 'utf8').split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue;
    if (!/^\s/.test(line)) { inGlobal = line.trim() === '/*'; continue; }
    const m = line.trim().match(/^([\w-]+):\s*(.*)$/);
    if (inGlobal && m) GLOBAL_HEADERS[m[1].toLowerCase()] = m[2];
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

async function toRequest(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  headers.set('x-forwarded-for', req.socket.remoteAddress || 'local');
  return new Request(`http://${req.headers.host || 'localhost'}${req.url}`, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
}

export function createServer({ env = process.env, fetchImpl } = {}) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        const response = await handleApi(await toRequest(req), env, { fetchImpl });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      let file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
      if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
      let s = await stat(file).catch(() => null);
      if (s && s.isDirectory()) { file = path.join(file, 'index.html'); s = await stat(file).catch(() => null); }
      if (!s) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
      const ext = path.extname(file);
      res.writeHead(200, {
        ...GLOBAL_HEADERS,
        'content-type': TYPES[ext] || 'application/octet-stream',
        'cache-control': ext === '.html' || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=0',
      });
      res.end(await readFile(file));
    } catch (e) {
      console.error(e);
      res.writeHead(500).end('server error');
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787);
  createServer().listen(port, () => {
    console.log(`Nutri dev server: http://localhost:${port}`);
    if (!process.env.ANTHROPIC_API_KEY) console.log('Note: ANTHROPIC_API_KEY not set — the assistant will report "not configured".');
  });
}
