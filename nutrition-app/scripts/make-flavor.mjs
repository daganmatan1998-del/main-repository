// Builds one self-contained project per app "flavor" under build/<flavor>/:
//   node scripts/make-flavor.mjs public      (the paid, public app)
//   node scripts/make-flavor.mjs friends     (the free app for friends)
//   node scripts/make-flavor.mjs all
// Each project has its own app id, name, Cloudflare Worker and native
// (Capacitor) projects, so the two apps never share an install, a backend or
// a quota. Re-running refreshes www/, server/ and the configs, and leaves the
// android/ and ios/ folders alone.
import { cpSync, readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(p, 'utf8');
const write = (p, s) => writeFileSync(p, s);

// Replace exactly one occurrence, or fail loudly: a silent miss would ship the
// wrong name or the wrong backend.
function patch(file, from, to) {
  const src = read(file);
  if (!src.includes(from)) throw new Error(`${file}: expected text not found: ${from}`);
  write(file, src.split(from).join(to));
}

function build(name) {
  const f = JSON.parse(read(join(ROOT, 'flavors', `${name}.json`)));
  const out = join(ROOT, 'build', name);
  mkdirSync(out, { recursive: true });
  for (const d of ['www', 'server']) {
    rmSync(join(out, d), { recursive: true, force: true });
    cpSync(join(ROOT, d), join(out, d), { recursive: true });
  }
  for (const file of ['.env.example', '.gitignore']) cpSync(join(ROOT, file), join(out, file));

  const www = join(out, 'www');
  const apiBase = String(f.apiBase || '').replace(/\/+$/, '');

  // Runtime config: which backend, which flavor.
  patch(join(www, 'js/config.js'), "export const API_BASE = '';", `export const API_BASE = ${JSON.stringify(apiBase)};\nexport const APP_FLAVOR = ${JSON.stringify(f.name)};`);

  // Names the user sees.
  patch(join(www, 'index.html'), '<title>נוטרי — תוכנית תזונה אישית</title>', `<title>${f.title}</title>`);
  patch(join(www, 'index.html'), 'name="apple-mobile-web-app-title" content="נוטרי"', `name="apple-mobile-web-app-title" content="${f.appName}"`);
  patch(join(www, 'js/screens/onboarding.js'), "'ברוכים הבאים לנוטרי'", `'ברוכים הבאים ל${f.appName}'`);

  const manifest = JSON.parse(read(join(www, 'manifest.webmanifest')));
  manifest.id = `./?app=${f.name}`;
  manifest.name = f.title;
  manifest.short_name = f.appName;
  manifest.theme_color = f.themeColor;
  write(join(www, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');

  // Separate cache name per flavor, so two PWAs on one origin can't collide.
  patch(join(www, 'sw.js'), "const VERSION = 'nutri-v", `const VERSION = 'nutri-${f.name}-v`);

  // A web build served from a different host than its API must be allowed to call it.
  if (apiBase) patch(join(www, '_headers'), "connect-src 'self';", `connect-src 'self' ${apiBase};`);

  // Backend: own Worker name + allowed origins.
  let toml = read(join(ROOT, 'wrangler.toml'));
  toml = toml.replace(/^name = ".*"$/m, `name = "${f.workerName}"`);
  toml = toml.replace(/^ALLOWED_ORIGINS = ".*"$/m, `ALLOWED_ORIGINS = "${f.allowedOrigins}"`);
  if (!toml.includes(`name = "${f.workerName}"`) || !toml.includes(`ALLOWED_ORIGINS = "${f.allowedOrigins}"`)) throw new Error('wrangler.toml patch failed');
  write(join(out, 'wrangler.toml'), toml);

  // Native shell.
  const cap = JSON.parse(read(join(ROOT, 'capacitor.config.json')));
  cap.appId = f.appId;
  cap.appName = f.appName;
  write(join(out, 'capacitor.config.json'), JSON.stringify(cap, null, 2) + '\n');

  const pkg = JSON.parse(read(join(ROOT, 'package.json')));
  pkg.name = `nutri-${f.name}`;
  pkg.scripts = { deploy: 'wrangler deploy', sync: 'cap sync' };
  pkg.dependencies = { ...pkg.dependencies, '@capacitor/core': '^8.0.0' };
  pkg.devDependencies = { ...pkg.devDependencies, '@capacitor/cli': '^8.0.0', '@capacitor/android': '^8.0.0', '@capacitor/ios': '^8.0.0', '@capacitor/assets': '^3.0.0' };
  write(join(out, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

  console.log(`${name}: build/${name}  (${f.appId}, worker ${f.workerName}, API_BASE ${apiBase || '(same origin — fill apiBase in flavors/' + name + '.json after the first deploy)'})`);
}

const arg = process.argv[2];
const names = arg === 'all' ? ['public', 'friends'] : [arg];
if (!arg || !names.every((n) => existsSync(join(ROOT, 'flavors', `${n}.json`)))) {
  console.error('usage: node scripts/make-flavor.mjs public|friends|all');
  process.exit(1);
}
names.forEach(build);
