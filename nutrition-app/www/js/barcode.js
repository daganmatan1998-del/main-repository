// Barcode reading and product lookup.
//
// Reading: ZBar (WebAssembly, vendored in www/vendor/zbar) on frames from the
// camera or on a photo — the same code on every browser, including iPhone
// Safari, which has no BarcodeDetector. Lookup: /api/barcode (Open Food Facts,
// via our server). Products already looked up are kept on the device, so the
// second scan of the same product works without a connection.

import { API_BASE } from './config.js';
import { lang } from './i18n.js';

const FORMATS = new Set(['EAN13', 'EAN8', 'UPCA', 'UPCE', 'ISBN13', 'ISBN10']);
let zbar = null;
const load = () => (zbar || (zbar = import('../vendor/zbar/zbar.mjs')));

// ZBar's own check digit already guards against misreads, but a vertical or
// blurry frame can still give a partial code: keep only complete product codes.
export const validCode = (c) => /^\d{8}$|^\d{12,14}$/.test(c);

// The code of the first product barcode in the image (ImageData), or null.
export async function decodeImageData(imageData) {
  const z = await load();
  const found = await z.scanImageData(imageData);
  for (const s of found) {
    if (!FORMATS.has(String(s.typeName || '').replace('ZBAR_', ''))) continue;
    const code = s.decode();
    if (validCode(code)) return code;
  }
  return null;
}

// Draws a source (video, image, bitmap) scaled to `maxSide` pixels on the long
// side and reads it.
export async function decodeSource(source, width, height, maxSide = 1000) {
  const k = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * k));
  const h = Math.max(1, Math.round(height * k));
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  return decodeImageData(ctx.getImageData(0, 0, w, h));
}

// A photo the person picked: tried whole, then at a larger size (small
// barcodes in a big photo need the pixels).
export async function decodeFile(file) {
  const bmp = await createImageBitmap(file);
  try {
    return (await decodeSource(bmp, bmp.width, bmp.height, 1000)) || (await decodeSource(bmp, bmp.width, bmp.height, 2000));
  } finally { bmp.close && bmp.close(); }
}

export const preload = () => { load().catch(() => {}); };

// ---- products ----
const KEY = 'nutri-scanned';
const readSaved = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
function remember(item) {
  try {
    const all = readSaved();
    delete all[item.code];
    const entries = Object.entries({ [item.code]: item, ...all }).slice(0, 60);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* storage unavailable */ }
}

// { found: true, ...product } | { found: false } | { error: 'offline' | 'upstream' }
export async function lookup(code, fetchImpl = fetch) {
  const saved = readSaved()[code];
  if (saved) return { found: true, ...saved };
  try {
    const res = await fetchImpl(`${API_BASE}/api/barcode?code=${encodeURIComponent(code)}&lang=${encodeURIComponent(lang)}`);
    if (res.status === 429) return { error: 'upstream' };
    if (!res.ok) return { error: 'upstream' };
    const j = await res.json();
    if (!j.found) return { found: false, code };
    const { ok, ...item } = j;
    remember(item);
    return item;
  } catch {
    return { error: 'offline' };
  }
}

// The amounts a person can choose from, and what a choice comes to.
// modes: grams, serving (servingG), package (packageG).
export function amountModes(p) {
  const modes = ['grams'];
  if (p.servingG) modes.unshift('serving');
  if (p.packageG) modes.splice(p.servingG ? 1 : 0, 0, 'package');
  return modes;
}

export function amountGrams(p, mode, qty) {
  const q = Math.max(0, Number(qty) || 0);
  if (mode === 'serving') return q * (p.servingG || 0);
  if (mode === 'package') return q * (p.packageG || 0);
  return q;
}

export function nutritionFor(p, grams) {
  const k = grams / 100;
  const r1 = (n) => Math.round(n * 10) / 10;
  return { kcal: Math.round(p.per100.kcal * k), p: r1(p.per100.p * k), c: r1(p.per100.c * k), f: r1(p.per100.f * k) };
}
