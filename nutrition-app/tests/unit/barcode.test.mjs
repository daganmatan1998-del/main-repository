import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleApi, normalizeProduct } from '../../server/api.js';

const OFF = {
  status: 1,
  product: {
    code: '7290000000001', product_name: 'Bamba', product_name_he: 'במבה', brands: 'Osem,Other', quantity: '80 g', product_quantity: '80', serving_size: '25 g', serving_quantity: 25,
    nutriments: { 'energy-kcal_100g': 534, proteins_100g: 15, carbohydrates_100g: 38, fat_100g: 34 },
  },
};
const stub = (body, status = 200) => {
  const calls = [];
  return { calls, fetchImpl: async (url, init) => { calls.push({ url: String(url), headers: new Headers(init.headers) }); return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); } };
};
const get = (q, headers = {}) => new Request(`https://nutri.example/api/barcode${q}`, { headers });

test('a known barcode comes back normalised, with the right user agent and language name', async () => {
  const { calls, fetchImpl } = stub(OFF);
  const res = await handleApi(get('?code=7290000000001&lang=he'), {}, { fetchImpl });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.deepEqual(j, { ok: true, found: true, code: '7290000000001', name: 'במבה', brand: 'Osem', per100: { kcal: 534, p: 15, c: 38, f: 34 }, micro100: null, servingG: 25, servingText: '25 g', packageG: 80, packageText: '80 g' });
  assert.match(calls[0].url, /openfoodfacts\.org\/api\/v2\/product\/7290000000001\.json/);
  assert.match(calls[0].headers.get('user-agent'), /^Nutri\//);
});

test('unknown product, bad codes and upstream trouble', async () => {
  assert.equal((await (await handleApi(get('?code=7290000000002'), {}, stub({ status: 0 }))).json()).found, false);
  assert.equal((await handleApi(get('?code=abc'), {}, stub(OFF))).status, 400);
  assert.equal((await handleApi(get('?code=123'), {}, stub(OFF))).status, 400);
  assert.equal((await handleApi(get('?code=7290000000003'), {}, stub({}, 500))).status, 502);
  assert.equal((await handleApi(new Request('https://nutri.example/api/barcode?code=7290000000004', { method: 'POST' }), {}, stub(OFF))).status, 405);
  assert.equal((await handleApi(get('?code=7290000000005', { origin: 'https://evil.example' }), {}, stub(OFF))).status, 403);
});

test('energy falls back from kJ; a product with no calories is not usable but still found by name', () => {
  assert.equal(normalizeProduct('1', { product_name: 'X', nutriments: { energy_100g: 418.4 } }).per100.kcal, 100);
  assert.equal(normalizeProduct('1', { product_name: 'X', nutriments: {} }).per100, null);
  assert.equal(normalizeProduct('1', { nutriments: { 'energy-kcal_100g': 10 } }), null);
  assert.equal(normalizeProduct('1', { product_name: 'X', nutriments: { 'energy-kcal_100g': 99999 } }).per100.kcal, 900);
  assert.equal(normalizeProduct('1', { product_name: 'Fallback', product_name_he: 'ברירה', nutriments: { 'energy-kcal_100g': 5 } }, 'en').name, 'Fallback');
});

test('label fiber, sugars and sodium come along (salt converts to sodium)', () => {
  const p = normalizeProduct('1', { product_name: 'X', nutriments: { 'energy-kcal_100g': 100, fiber_100g: 3.04, sugars_100g: 12, salt_100g: 1.25 } });
  assert.deepEqual(p.micro100, { fiber: 3, sugar: 12, sodium: 500 });
  assert.equal(normalizeProduct('1', { product_name: 'X', nutriments: { 'energy-kcal_100g': 100, sodium_100g: 0.4 } }).micro100.sodium, 400);
});

test('product search: normalised, only products with calories, bad queries refused', async () => {
  const body = { products: [
    { code: '1', product_name: 'Hummus', brands: 'Achva', nutriments: { 'energy-kcal_100g': 300 } },
    { code: '2', product_name: 'No energy', nutriments: {} },
    { code: '3', nutriments: { 'energy-kcal_100g': 5 } },
  ] };
  const { calls, fetchImpl } = stub(body);
  const res = await handleApi(new Request('https://nutri.example/api/foodsearch?q=hummus&lang=en'), {}, { fetchImpl });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.deepEqual(j.items.map((i) => i.code), ['1']);
  assert.match(calls[0].url, /search_terms=hummus/);
  assert.equal((await handleApi(new Request('https://nutri.example/api/foodsearch?q=a'), {}, stub(body))).status, 400);
  assert.equal((await handleApi(new Request('https://nutri.example/api/foodsearch?q=hummus'), {}, stub({}, 500))).status, 502);
  assert.equal((await handleApi(new Request('https://nutri.example/api/foodsearch?q=hummus', { headers: { origin: 'https://evil.example' } }), {}, stub(body))).status, 403);
});
