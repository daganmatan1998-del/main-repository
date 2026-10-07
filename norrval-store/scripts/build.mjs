// Static build: renders every page to dist/ with clean URLs, copies and
// minifies assets, writes sitemap.xml and robots.txt. `node scripts/build.mjs`
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const { setManifest } = await import('../components/picture.js');
const manifestPath = path.join(ROOT, 'assets/img/manifest.json');
// Local, self-hosted images win; Higgsfield-hosted copies fill any slot without one.
const local = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const { _note, ...remote } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/remote-images.json'), 'utf8'));
setManifest({ ...remote, ...local });

const { STORE } = await import('../data/store.js');
const { homePage } = await import('../pages/home.js');
const { productPage } = await import('../pages/product.js');
const { aboutPage } = await import('../pages/about.js');
const { contactPage } = await import('../pages/contact.js');
const { faqPage } = await import('../pages/faq.js');
const { trackPage } = await import('../pages/track.js');
const { cartPage } = await import('../pages/cart.js');
const { checkoutPage } = await import('../pages/checkout.js');
const { notFoundPage } = await import('../pages/notfound.js');
const { legalPages } = await import('../pages/legal.js');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const pages = [
  { path: '/', html: homePage(), priority: '1.0' },
  { path: '/products/nocturne/', html: productPage(), priority: '0.9' },
  { path: '/about/', html: aboutPage(), priority: '0.6' },
  { path: '/faq/', html: faqPage(), priority: '0.6' },
  { path: '/contact/', html: contactPage(), priority: '0.5' },
  { path: '/track/', html: trackPage(), priority: '0.3' },
  { path: '/cart/', html: cartPage(), index: false },
  { path: '/checkout/', html: checkoutPage(), index: false },
  ...legalPages().map((p) => ({ ...p, priority: '0.3' })),
];

// Drop only line-break indentation between tags, so inline spacing survives.
const minifyHtml = (h) =>
  h
    .replace(/>\s*\n\s*</g, '><')
    .replace(/\n\s+/g, '\n')
    .trim();

for (const p of pages) {
  const dir = path.join(DIST, p.path);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), minifyHtml(p.html));
}
fs.writeFileSync(path.join(DIST, '404.html'), minifyHtml(notFoundPage()));

// ---------- assets ----------
const out = path.join(DIST, 'assets');
fs.mkdirSync(out, { recursive: true });
let esbuild = null;
try {
  esbuild = await import('esbuild');
} catch {
  console.warn('esbuild not installed — copying CSS/JS unminified (run `npm install`).');
}
const css = fs.readFileSync(path.join(ROOT, 'styles/main.css'), 'utf8');
fs.writeFileSync(
  path.join(out, 'main.css'),
  esbuild ? (await esbuild.transform(css, { loader: 'css', minify: true })).code : css,
);
for (const f of fs.readdirSync(path.join(ROOT, 'assets/js'), { withFileTypes: true })) {
  if (f.isDirectory()) continue; // vendor/ is handled below — copied as-is, already minified
  const src = fs.readFileSync(path.join(ROOT, 'assets/js', f.name), 'utf8');
  fs.writeFileSync(
    path.join(out, f.name),
    esbuild ? (await esbuild.transform(src, { loader: 'js', minify: true, target: 'es2020' })).code : src,
  );
}
const vendorDir = path.join(ROOT, 'assets/js/vendor');
if (fs.existsSync(vendorDir)) {
  fs.cpSync(vendorDir, path.join(out, 'vendor'), { recursive: true });
}
if (fs.existsSync(path.join(ROOT, 'assets/img'))) {
  fs.cpSync(path.join(ROOT, 'assets/img'), path.join(out, 'img'), {
    recursive: true,
    filter: (s) => !s.endsWith('manifest.json'),
  });
}
for (const f of ['favicon.svg', 'logo.png', 'og.jpg']) {
  const s = path.join(ROOT, 'assets', f);
  if (fs.existsSync(s)) fs.copyFileSync(s, path.join(out, f));
}

// ---------- sitemap + robots ----------
const base = STORE.siteUrl.replace(/\/$/, '');
const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(
  path.join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .filter((p) => p.index !== false)
    .map((p) => `  <url><loc>${base}${p.path}</loc><lastmod>${today}</lastmod><priority>${p.priority}</priority></url>`)
    .join('\n')}\n</urlset>\n`,
);
fs.writeFileSync(
  path.join(DIST, 'robots.txt'),
  `User-agent: *\nDisallow: /cart/\nDisallow: /checkout/\n\nSitemap: ${base}/sitemap.xml\n`,
);

console.log(`Built ${pages.length + 1} pages into dist/`);
