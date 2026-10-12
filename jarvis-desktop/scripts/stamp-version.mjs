#!/usr/bin/env node
/* STAMP A BUILD (run before every upload of dist/ to Cloudflare).

   Gives dist/index.html a build id made from its own contents, and writes
   dist/version.json with the same id. The page compares the two: when the
   id it is running differs from the one on the server, it asks him whether
   to update.

     node scripts/stamp-version.mjs            (from jarvis-desktop/)

   Run it again after any change to index.html: the id changes only when the
   page does, so an unchanged page never asks him to update. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const pagePath = join(dist, 'index.html');
const META = /<meta name="jarvis-build" content="[^"]*">\n?/;

const page = readFileSync(pagePath, 'utf8');
const bare = page.replace(META, '');
const build = createHash('sha256').update(bare).digest('hex').slice(0, 12);
const stamped = bare.replace(/<meta charset="UTF-8">\n/, (m) => `${m}<meta name="jarvis-build" content="${build}">\n`);
if (!stamped.includes(`name="jarvis-build" content="${build}"`)) {
  throw new Error('could not place the build id: <meta charset="UTF-8"> not found in index.html');
}
writeFileSync(pagePath, stamped);
writeFileSync(join(dist, 'version.json'), JSON.stringify({ build, stampedAt: new Date().toISOString() }, null, 2) + '\n');
console.log(`build ${build} stamped into index.html and version.json`);
