// Writes the list of everything to translate (tools/i18n/catalog.json): one
// entry per message, in reading order (grouped by file), with what a
// translator needs to know — the English text, the context after ‖, whether
// it is a list of search words, and how the code fills its placeholders.
//
//   node tools/i18n/catalog.mjs [out.json]

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { ROOT, english, contextOf } from './keys.mjs';

const JS = path.join(ROOT, 'www/js');
const files = (dir) => readdirSync(dir).flatMap((f) => {
  const p = path.join(dir, f);
  if (statSync(p).isDirectory()) return f === 'lang' ? [] : files(p);
  return p.endsWith('.js') ? [p] : [];
}).sort();

export function buildCatalog() {
  const entries = new Map();
  for (const file of files(JS)) {
    const src = readFileSync(file, 'utf8');
    const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
    const rel = path.relative(JS, file);
    walk.simple(ast, {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || !['tr', 'trl', 'raw'].includes(node.callee.name)) return;
        const a = node.arguments[0];
        if (!a || a.type !== 'Literal' || typeof a.value !== 'string') return;
        const key = a.value;
        if (entries.has(key)) { entries.get(key).files.add(rel); return; }
        const args = node.arguments.slice(1).map((x) => src.slice(x.start, x.end).replace(/\s+/g, ' ').slice(0, 70));
        entries.set(key, { key, en: english(key), context: contextOf(key), kind: node.callee.name === 'trl' ? 'search-words' : node.callee.name === 'raw' ? 'unit' : 'text', args, files: new Set([rel]) });
      },
    });
  }
  return [...entries.values()].map((e) => ({ ...e, files: [...e.files] }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] || path.join(ROOT, 'tools/i18n/catalog.json');
  const list = buildCatalog();
  writeFileSync(out, JSON.stringify(list, null, 1));
  console.log(`${list.length} messages -> ${out}`);
}
