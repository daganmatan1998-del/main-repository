// Pairs the English with a pack's translation for an independent review.
//   node tools/i18n/review-input.mjs <lang> <outdir> [parts=2]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './keys.mjs';
import { buildCatalog } from './catalog.mjs';

const [lang, dir, parts = '2'] = process.argv.slice(2);
const pack = (await import(pathToFileURL(path.join(ROOT, `www/js/lang/${lang}.js`)).href)).default;
const ui = { ...pack.ui, ...(pack.fn || {}) };
const list = buildCatalog().map((e) => ({ key: e.key, en: e.en, [lang]: ui[e.key], context: e.context, kind: e.kind, args: e.args }));
mkdirSync(dir, { recursive: true });
const n = Number(parts);
const size = Math.ceil(list.length / n);
for (let i = 0; i < n; i++) writeFileSync(path.join(dir, `review_in_${i}.json`), JSON.stringify(list.slice(i * size, (i + 1) * size), null, 0));
console.log(`${list.length} entries in ${n} parts -> ${dir}`);
