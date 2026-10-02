// Fails (exit 1) if the worker's prices, sizes, colours or shipping rates drift
// from assets/js/catalog.js and config.js. Run: node tools/check-worker-sync.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { PRODUCTS, SHIPPING, FREE_SHIPPING_OVER } from "../worker/checkout-worker.js";

const here = new URL("..", import.meta.url);
const ctx = { window: {} };
vm.createContext(ctx);
for (const f of ["assets/js/config.js", "assets/js/catalog.js"]) vm.runInContext(readFileSync(new URL(f, here), "utf8"), ctx);
const CFG = ctx.window.VANTE_CONFIG, CAT = ctx.window.VANTE_CATALOG;
const errs = [];
for (const p of CAT.PRODUCTS) {
  const w = PRODUCTS[p.id];
  if (!w) { errs.push(`worker missing product ${p.id}`); continue; }
  if (w.price !== p.price) errs.push(`${p.id}: price ${w.price} != ${p.price}`);
  if (w.name !== p.name) errs.push(`${p.id}: name differs`);
  for (const v of p.variants) {
    if (!w.colors.includes(v.color)) errs.push(`${p.id}: worker lacks colour ${v.color}`);
    if (v.price && v.price !== p.price) errs.push(`${p.id}/${v.color}: variant price overrides are not supported by the worker`);
    const sizes = CAT.sizes(p, v);
    if (sizes.join() !== w.sizes.join()) errs.push(`${p.id}/${v.color}: sizes ${w.sizes} != ${sizes}`);
  }
}
for (const id of Object.keys(PRODUCTS)) if (!CAT.product(id)) errs.push(`worker has unknown product ${id}`);
if (FREE_SHIPPING_OVER !== CFG.freeShippingOver) errs.push("free shipping threshold differs");
for (const z of CFG.shipping) {
  const w = SHIPPING[z.id];
  if (!w) { errs.push(`worker missing zone ${z.id}`); continue; }
  if (Object.keys(z.countries).sort().join() !== [...w.countries].sort().join()) errs.push(`zone ${z.id}: countries differ`);
  for (const m of z.methods) {
    const wm = w.methods[m.id];
    if (!wm) errs.push(`zone ${z.id}: worker missing method ${m.id}`);
    else if (wm.price !== m.price || wm.free !== m.freeEligible) errs.push(`zone ${z.id}/${m.id}: rate differs`);
  }
}
if (errs.length) { console.error("OUT OF SYNC:\n- " + errs.join("\n- ")); process.exit(1); }
console.log(`worker in sync: ${CAT.PRODUCTS.length} products, ${CFG.shipping.length} zones`);
