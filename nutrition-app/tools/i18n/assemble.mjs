// Turns translated chunks into a language pack.
//
//   node tools/i18n/assemble.mjs <lang> <dir-with-out_*.json>
//
// Each out_N.json maps message key -> translation. The pack is written to
// www/js/lang/<lang>.js (existing entries are replaced by the new ones).

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './keys.mjs';

const [lang, dir] = process.argv.slice(2);
if (!lang || !dir) { console.error('usage: assemble.mjs <lang> <dir>'); process.exit(2); }
const file = path.join(ROOT, `www/js/lang/${lang}.js`);
const names = readdirSync(dir).filter((f) => /^out_.*\.json$/.test(f)).sort();
const fresh = {};
for (const n of names) Object.assign(fresh, JSON.parse(readFileSync(path.join(dir, n), 'utf8')));
let ui = {};
if (existsSync(file)) ui = (await import(pathToFileURL(file).href + `?t=${Date.now()}`)).default.ui;
Object.assign(ui, fresh);
const lines = Object.entries(ui).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');
writeFileSync(file, `// ${lang} — the app's texts. Keys are the English messages (see i18n.js); checked by tools/i18n/check.mjs.\nexport default {\n  ui: {\n${lines}\n  },\n  data: {},\n};\n`);
console.log(`${lang}: ${Object.keys(fresh).length} new, ${Object.keys(ui).length} total -> ${file}`);
