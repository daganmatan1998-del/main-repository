// The barcode reader on real pixels: an EAN-13 is drawn, turned into a video that
// Chromium's fake camera plays, and read back through the same code the app uses
// (ZBar in WebAssembly) — live from the camera, from a photo, and via the
// product lookup (/api/barcode, with Open Food Facts stubbed).
// Run: node tests/e2e/barcode.mjs   (needs ffmpeg)

import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../../server/dev-server.mjs';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = playwright;

let failed = 0;
const check = (name, cond, detail = '') => { if (!cond) failed++; console.log(`${cond ? '✓' : '✗'} ${name}${!cond && detail ? ` — ${detail}` : ''}`); };

import { ean13Modules, withCheck, ppm } from './ean.mjs';

const CODE = withCheck('729000010123');
const dir = mkdtempSync(path.join(tmpdir(), 'nutri-barcode-'));
writeFileSync(path.join(dir, 'b.ppm'), ppm(CODE));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', path.join(dir, 'b.ppm'), '-t', '3', '-r', '15', '-pix_fmt', 'yuv420p', path.join(dir, 'b.y4m')]);

// ---- Open Food Facts, stubbed ----
let offCalls = 0;
const fetchImpl = async (url) => {
  offCalls++;
  const code = String(url).match(/product\/(\d+)\.json/)[1];
  if (code !== CODE) return new Response(JSON.stringify({ status: 0 }), { status: 404 });
  return new Response(JSON.stringify({ status: 1, product: { product_name: 'Test snack', brands: 'Brand', quantity: '60 g', product_quantity: 60, serving_size: '20 g', serving_quantity: 20, nutriments: { 'energy-kcal_100g': 500, proteins_100g: 10, carbohydrates_100g: 50, fat_100g: 25 } } }), { status: 200 });
};
const server = createServer({ env: { NO_PUSH: '1' }, fetchImpl });
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}`;

const LAUNCH = { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${path.join(dir, 'b.y4m')}`, '--autoplay-policy=no-user-gesture-required'] };
const browser = await chromium.launch({ channel: 'chromium', ...LAUNCH }).catch(() => chromium.launch(LAUNCH));
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.grantPermissions(['camera'], { origin: BASE });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}/`);
await page.waitForLoadState('networkidle');

const live = await page.evaluate(async () => {
  const { decodeSource } = await import('/js/barcode.js');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 } }, audio: false });
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.srcObject = stream;
  await video.play();
  let code = null; let tries = 0;
  while (!code && tries < 60) { await new Promise((r) => setTimeout(r, 100)); if (video.videoWidth) code = await decodeSource(video, video.videoWidth, video.videoHeight, 1000); tries++; }
  stream.getTracks().forEach((t) => t.stop());
  return { code, tries };
});
check(`the fake camera's barcode is read live (${live.code} after ${live.tries} tries)`, live.code === CODE);

const photo = await page.evaluate(async (bytes) => {
  const { decodeFile } = await import('/js/barcode.js');
  const blob = new Blob([Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))], { type: 'image/png' });
  return decodeFile(new File([blob], 'b.png', { type: 'image/png' }));
}, await (async () => {
  // The same barcode as a PNG, drawn in the page.
  const dataUrl = await page.evaluate((bits) => {
    const unit = 4; const c = document.createElement('canvas'); c.width = bits.length * unit + 80; c.height = 200;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#000';
    for (let i = 0; i < bits.length; i++) if (bits[i] === '1') g.fillRect(40 + i * unit, 30, unit, 140);
    return c.toDataURL('image/png');
  }, ean13Modules(CODE));
  return dataUrl.split(',')[1];
})());
check('a photo of the barcode is read', photo === CODE, String(photo));

const blank = await page.evaluate(async () => {
  const { decodeSource } = await import('/js/barcode.js');
  const c = document.createElement('canvas'); c.width = 300; c.height = 200; c.getContext('2d').fillRect(0, 0, 10, 10);
  return decodeSource(c, 300, 200);
});
check('an image with no barcode gives null', blank === null);

const looked = await page.evaluate(async (code) => {
  const { lookup } = await import('/js/barcode.js');
  const a = await lookup(code); const b = await lookup(code); const none = await lookup('7290000099999');
  return { a, b, none };
}, CODE);
check('the product is looked up through our server', looked.a.found && looked.a.name === 'Test snack' && looked.a.per100.kcal === 500 && looked.a.servingG === 20 && looked.a.packageG === 60, JSON.stringify(looked.a));
check('the second scan comes from the device, not the network', looked.b.found && offCalls === 2, `calls ${offCalls}`);
check('an unknown product is "not found"', looked.none.found === false);
check('no page errors', errors.length === 0, errors.join(' | '));

await browser.close();
server.close();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
