// Finds every message the app can show: the first argument of tr()/trl()/raw()
// calls in www/js (the code writes them as plain string literals on purpose).
// Used by the pack checks and by the translation catalog.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const JS = path.join(ROOT, 'www/js');

const files = (dir) => readdirSync(dir).flatMap((f) => {
  const p = path.join(dir, f);
  if (statSync(p).isDirectory()) return f === 'lang' ? [] : files(p);
  return p.endsWith('.js') ? [p] : [];
});

const FUNCS = new Set(['tr', 'trl', 'raw']);

// -> { keys: Map(key -> { kind: 'tr' | 'trl' | 'raw', files: Set }), dynamic: [ 'file:line' ] }
export function usedKeys() {
  const keys = new Map();
  const dynamic = [];
  for (const file of files(JS)) {
    const src = readFileSync(file, 'utf8');
    const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
    const rel = path.relative(JS, file);
    walk.simple(ast, {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || !FUNCS.has(node.callee.name)) return;
        const a = node.arguments[0];
        if (!a) return;
        if (a.type === 'Literal' && typeof a.value === 'string') {
          const e = keys.get(a.value) || { kind: node.callee.name, files: new Set() };
          e.files.add(rel);
          keys.set(a.value, e);
        } else if (a.type === 'TemplateLiteral' && !a.expressions.length) {
          const v = a.quasis[0].value.cooked;
          const e = keys.get(v) || { kind: node.callee.name, files: new Set() };
          e.files.add(rel);
          keys.set(v, e);
        } else dynamic.push(`${rel}:${node.loc.start.line}`);
      },
    });
  }
  return { keys, dynamic };
}

// The message as a reader sees it in English: without its ‖context.
export const english = (key) => { const i = key.indexOf('‖'); return i < 0 ? key : key.slice(0, i); };
export const contextOf = (key) => { const i = key.indexOf('‖'); return i < 0 ? '' : key.slice(i + 1); };
