// Copies the Draco and Basis (KTX2) decoders shipped with three into public/,
// so compressed glTF files decode fully offline — no CDN involved.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const libs = resolve(root, 'node_modules/three/examples/jsm/libs');
const out = resolve(root, 'public/decoders');

const copies = [
  ['draco/gltf', 'draco'],
  ['basis', 'basis'],
];

for (const [from, to] of copies) {
  const src = resolve(libs, from);
  if (!existsSync(src)) {
    console.warn(`[decoders] missing ${src}, skipping`);
    continue;
  }
  mkdirSync(resolve(out, to), { recursive: true });
  cpSync(src, resolve(out, to), { recursive: true });
}
console.log('[decoders] copied to public/decoders');
