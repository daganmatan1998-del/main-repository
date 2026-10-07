// Bundle the whole built store into ONE self-contained HTML file that opens
// straight from disk (double-click, no server): every page, all CSS and JS
// inlined, internal links turned into #/ routes handled by a tiny router.
// Run after `npm run build`:  npm run single  →  dist/norrval-store.html
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const read = (p) => fs.readFileSync(path.join(DIST, p), 'utf8');

const ROUTES = [
  '/',
  '/products/nocturne/',
  '/about/',
  '/faq/',
  '/contact/',
  '/track/',
  '/cart/',
  '/checkout/',
  '/accessibility/',
  '/policies/shipping/',
  '/policies/returns/',
  '/policies/cancellation/',
  '/policies/terms/',
  '/policies/privacy/',
  '/policies/cookies/',
];

const MAIN_OPEN = '<main id="main" tabindex="-1">';
const split = (html) => {
  const a = html.indexOf(MAIN_OPEN);
  const b = html.lastIndexOf('</main>');
  if (a < 0 || b < 0) throw new Error('page has no <main>');
  return { before: html.slice(0, a), inner: html.slice(a + MAIN_OPEN.length, b), after: html.slice(b + 7) };
};
const titleOf = (html) => (html.match(/<title>([^<]*)<\/title>/) || [])[1] || 'NORRVAL';

// Internal links → hash routes. "/#gift" becomes "#/@gift" (scroll target on home).
const rehref = (s) =>
  s
    .replace(/href="\/#([\w-]+)"/g, 'href="#/@$1"')
    .replace(/href="\/(?!\/)([^"]*)"/g, 'href="#/$1"');

const pages = ROUTES.map((r) => {
  const html = read(r === '/' ? 'index.html' : r.slice(1) + 'index.html');
  return { route: r, title: titleOf(html), inner: split(html).inner };
});
const nf = read('404.html');
pages.push({ route: '/404', title: titleOf(nf), inner: split(nf).inner });

const home = split(read('index.html'));
const css = read('assets/main.css');
const favicon = 'data:image/svg+xml,' + encodeURIComponent(fs.readFileSync(path.join(ROOT, 'assets/favicon.svg'), 'utf8'));

// Head: drop external stylesheet, JSON-LD and the absolute canonical/OG URLs
// (they describe the deployed site, not a local file).
let head = home.before
  // Function replacers: css/favicon are dynamic content that could contain a
  // literal $-pattern a string replacement would misinterpret (see below).
  .replace(/<link rel="stylesheet" href="\/assets\/main.css">/, () => `<style>${css}</style>`)
  .replace(/<link rel="icon"[^>]*>/, () => `<link rel="icon" href="${favicon}" type="image/svg+xml">`)
  .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '')
  .replace(/<link rel="canonical"[^>]*>/, '')
  .replace(/<meta property="og:(url|image)"[^>]*>|<meta name="twitter:image"[^>]*>/g, '')
  .replace(/<link rel="preload"[^>]*>/g, '');
head = rehref(head);

let tail = rehref(home.after)
  .replace(/<script src="\/assets\/[^"]+" defer><\/script>/g, '')
  .replace(/"url":"\/products\/nocturne\/"/, '"url":"#/products/nocturne/"');

const js = (f) =>
  rehref(read('assets/' + f)).replace(/(['"`])\/checkout\/\1/g, '$1#/checkout/$1');

const router = `(()=>{"use strict";
const pages=[...document.querySelectorAll('.spa-page')];
const nav=[...document.querySelectorAll('.nav a')];
function show(){
  const h=location.hash;
  if(h&&!h.startsWith('#/'))return; // e.g. #main skip link
  let r=(h.slice(1)||'/'),anchor=null;
  const at=r.indexOf('@');if(at>-1){anchor=r.slice(at+1);r=r.slice(0,at)||'/';}
  if(!r.endsWith('/'))r+='/';
  let pg=pages.find(p=>p.dataset.route===r)||pages.find(p=>p.dataset.route==='/404');
  pages.forEach(p=>p.hidden=p!==pg);
  document.title=pg.dataset.title;
  nav.forEach(a=>{const t=a.getAttribute('href').slice(1);a.toggleAttribute('aria-current',r.startsWith(t)&&t!=='/');if(a.hasAttribute('aria-current'))a.setAttribute('aria-current','page');});
  document.body.classList.remove('drawer-open');document.documentElement.style.overflow='';
  dispatchEvent(new Event('resize'));
  requestAnimationFrame(()=>{const el=anchor&&document.getElementById(anchor);el?el.scrollIntoView():scrollTo(0,0);dispatchEvent(new Event('scroll'));});
}
addEventListener('hashchange',show);show();
})();`;

const body = pages
  .map(
    (p) =>
      `<div class="spa-page" data-route="${p.route}" data-title="${p.title.replace(/"/g, '&quot;')}"${p.route === '/' ? '' : ' hidden'}>${rehref(p.inner)}</div>`,
  )
  .join('');

// Vendor files are read raw (no rehref/checkout rewriting — that's for our
// own page scripts, not third-party minified code) and must stay ordered
// before exploded.js, which calls into them at script-run time.
const raw = (f) => read('assets/' + f);
const scripts = [
  js('app.js'),
  js('home.js'),
  js('product.js'),
  raw('vendor/gsap.min.js'),
  raw('vendor/ScrollTrigger.min.js'),
  js('exploded.js'),
  js('forms.js'),
  js('checkout.js'),
]
  .map((code) => `<script>${code}</script>`)
  .join('');

// A function replacer, not a string one: the vendor bundles contain literal
// `$&`/`$1` sequences that `String.replace(search, string)` would otherwise
// reinterpret as backreference patterns and silently corrupt.
const out = `${head}${MAIN_OPEN}${body}</main>${tail.replace('</body>', () => `${scripts}<script>${router}</script></body>`)}`;
fs.writeFileSync(path.join(DIST, 'norrval-store.html'), out);
console.log(`Wrote dist/norrval-store.html (${(out.length / 1024).toFixed(0)} KB, ${pages.length} pages)`);
