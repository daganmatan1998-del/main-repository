/// <reference types="node" />
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM server module without type declarations
import { createHandler } from '../server/stt-proxy.mjs';

let server: http.Server | null = null;
afterEach(() => server?.close());

async function start(opts: Record<string, unknown>): Promise<string> {
  server = http.createServer(createHandler(opts));
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe('speech-to-text proxy', () => {
  it('reports "not configured" without a key, so the game can say so', async () => {
    const base = await start({ apiKey: undefined });
    const r = await fetch(`${base}/api/stt/health`);
    expect(r.status).toBe(503);
    const post = await fetch(`${base}/api/stt?lang=he-IL`, { method: 'POST', body: new Uint8Array([1, 2, 3]) });
    expect(post.status).toBe(503);
  });

  it('forwards audio with the server-held key and returns only text', async () => {
    let seen: { auth?: string; lang?: string; prompt?: unknown } = {};
    const fakeFetch = async (_url: string, init: { headers: Record<string, string>; body: FormData }) => {
      seen = { auth: init.headers.Authorization, lang: String(init.body.get('language')), prompt: init.body.get('prompt') };
      return new Response(JSON.stringify({ text: ' שלום ', usage: { secret: 'x' } }), { status: 200 });
    };
    const base = await start({ apiKey: 'sk-test', fetchImpl: fakeFetch });
    const health = await (await fetch(`${base}/api/stt/health`)).json();
    expect(health.ok).toBe(true);
    const r = await fetch(`${base}/api/stt?lang=he-IL`, { method: 'POST', body: new Uint8Array([1, 2, 3]), headers: { 'Content-Type': 'audio/webm' } });
    expect(await r.json()).toEqual({ text: 'שלום' });
    expect(seen.auth).toBe('Bearer sk-test');
    expect(seen.lang).toBe('he');
    expect(seen.prompt).toBeNull(); // the target word is never sent as a hint
  });

  it('rejects unsupported languages and empty audio', async () => {
    const base = await start({ apiKey: 'sk-test', fetchImpl: async () => new Response('{}') });
    expect((await fetch(`${base}/api/stt?lang=fr-FR`, { method: 'POST', body: new Uint8Array([1]) })).status).toBe(400);
    expect((await fetch(`${base}/api/stt?lang=en-US`, { method: 'POST', body: new Uint8Array([]) })).status).toBe(400);
  });

  it('surfaces upstream failure as 502, not as an empty transcript', async () => {
    const base = await start({ apiKey: 'sk-test', fetchImpl: async () => new Response('nope', { status: 401 }) });
    const r = await fetch(`${base}/api/stt?lang=en-US`, { method: 'POST', body: new Uint8Array([1, 2]) });
    expect(r.status).toBe(502);
  });
});
