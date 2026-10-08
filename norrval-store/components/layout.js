import { STORE, MARKETS, SHIPPING, PRODUCT, OFFERS, RETURNS } from '../data/store.js';
import { esc, txt, money, jsonLd } from '../utils/html.js';
import { ICONS, LOGO } from './icons.js';
import { imageUrl } from './picture.js';

export const NAV = [
  { href: '/products/nocturne/', label: 'Shop' },
  { href: '/about/', label: 'Our story' },
  { href: '/faq/', label: 'FAQ' },
  { href: '/contact/', label: 'Support' },
];

export const LEGAL_LINKS = [
  { href: '/policies/shipping/', label: 'Shipping Policy' },
  { href: '/policies/returns/', label: 'Returns & Refunds' },
  { href: '/policies/cancellation/', label: 'Order Cancellation' },
  { href: '/policies/terms/', label: 'Terms of Service' },
  { href: '/policies/privacy/', label: 'Privacy Policy' },
  { href: '/policies/cookies/', label: 'Cookie Policy' },
  { href: '/accessibility/', label: 'Accessibility' },
];

const cur = MARKETS.defaultCurrency;
const fmt = (n) => money(n, cur, MARKETS.currencies[cur].locale);

function announcement() {
  const t = SHIPPING.freeShippingThreshold;
  if (OFFERS.launch.enabled && OFFERS.launch.headline) {
    return `<div class="announce">${esc(OFFERS.launch.headline)}</div>`;
  }
  if (t) return `<div class="announce">Free shipping on orders over ${fmt(t)}</div>`;
  return `<div class="announce">Every Nocturne arrives in its presentation box &nbsp;·&nbsp; <a href="/policies/returns/">Returns policy</a></div>`;
}

function header(path) {
  const link = (n) =>
    `<li><a href="${n.href}"${path.startsWith(n.href) ? ' aria-current="page"' : ''}>${n.label}</a></li>`;
  return `
<a class="skip-link" href="#main">Skip to content</a>
<div class="progress" aria-hidden="true"></div>
${announcement()}
<header class="header" id="top">
  <div class="wrap header__inner">
    <button class="icon-btn burger" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="mobile-nav" data-menu-open>${ICONS.menu}</button>
    <a class="logo" href="/" aria-label="NORRVAL home">${LOGO}</a>
    <nav class="nav" aria-label="Main">
      <ul>${NAV.map(link).join('')}</ul>
    </nav>
    <div class="header__actions">
      <button class="icon-btn" type="button" aria-label="Open cart" data-cart-open>${ICONS.bag}<span class="cart-count" data-cart-count aria-hidden="true">0</span><span class="sr-only" data-cart-count-sr>, 0 items</span></button>
    </div>
  </div>
</header>
<div class="mobile-nav" id="mobile-nav" role="dialog" aria-modal="true" aria-label="Menu" hidden>
  <button class="icon-btn mobile-nav__close" type="button" aria-label="Close menu" data-menu-close>${ICONS.close}</button>
  <ul>
    <li><a href="/">Home</a></li>
    ${NAV.map((n) => `<li><a href="${n.href}">${n.label}</a></li>`).join('')}
    <li><a href="/track/">Track order</a></li>
  </ul>
  <div class="mobile-nav__foot">
    <a href="/policies/shipping/">Shipping</a>
    <a href="/policies/returns/">Returns</a>
    <span>${txt(STORE.supportEmail)}</span>
  </div>
</div>`;
}

function footer() {
  const col = (title, links) =>
    `<div><h2>${title}</h2><ul>${links.map((l) => `<li><a href="${l.href}">${l.label}</a></li>`).join('')}</ul></div>`;
  const year = new Date().getFullYear();
  return `
<footer class="footer">
  <div class="wrap">
    <div class="footer__top">
      <div class="newsletter">
        <a class="logo" href="/" aria-label="NORRVAL home" style="justify-self:start">${LOGO}</a>
        <p class="muted" style="margin:20px 0 0;max-width:30em">Occasional letters about new releases and restocks. No daily emails. Unsubscribe any time.</p>
        <form data-newsletter novalidate>
          <div class="nl-row">
            <label class="sr-only" for="nl-email">Email address</label>
            <input class="input" id="nl-email" name="email" type="email" autocomplete="email" placeholder="Email address" required>
            <button class="btn" type="submit">Join</button>
          </div>
          <label class="check"><input type="checkbox" name="consent"> <span>I agree to receive marketing emails from NORRVAL and have read the <a href="/policies/privacy/">Privacy Policy</a>.</span></label>
          <p class="form-msg" data-nl-msg role="status" hidden></p>
        </form>
      </div>
      <div class="footer__cols">
        ${col('Shop', [
          { href: '/products/nocturne/', label: 'Nocturne' },
          { href: '/#gift', label: 'Gifting' },
          { href: '/cart/', label: 'Cart' },
        ])}
        ${col('Help', [
          { href: '/faq/', label: 'FAQ' },
          { href: '/policies/shipping/', label: 'Shipping' },
          { href: '/policies/returns/', label: 'Returns' },
          { href: '/track/', label: 'Track order' },
          { href: '/contact/', label: 'Contact us' },
        ])}
        ${col('Company', [
          { href: '/about/', label: 'Our story' },
          { href: '/accessibility/', label: 'Accessibility' },
          ...STORE.socials.map((s) => ({ href: s.url, label: s.name })),
        ])}
        <div><h2>Legal</h2><ul>${LEGAL_LINKS.filter((l) => l.href.startsWith('/policies/'))
          .map((l) => `<li><a href="${l.href}">${l.label}</a></li>`)
          .join('')}<li><button class="linklike" type="button" data-consent-open>Cookie settings</button></li></ul></div>
      </div>
    </div>
    <div class="footer__bottom">
      <span>© ${year} ${txt(STORE.legalName)}. All rights reserved.</span>
      <ul class="pay-list" aria-label="Accepted payment methods">${STORE.payments.accepted.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      <button class="region-btn" type="button" data-region-open>${ICONS.globe.replace('<svg', '<svg width="14" height="14"')}<span data-region-label>${esc(cur)}</span></button>
    </div>
  </div>
</footer>`;
}

function drawer() {
  return `
<div class="drawer-backdrop" data-cart-close></div>
<aside class="drawer" id="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title" tabindex="-1">
  <div class="drawer__head">
    <h2 id="cart-title">Your cart</h2>
    <button class="icon-btn" type="button" aria-label="Close cart" data-cart-close>${ICONS.close}</button>
  </div>
  <div class="drawer__body" data-cart-lines aria-live="polite"></div>
  <div class="drawer__foot" data-cart-foot></div>
</aside>`;
}

function consent() {
  return `
<section class="consent" data-consent-banner aria-labelledby="consent-title" hidden>
  <h2 id="consent-title">Cookies on this site</h2>
  <p>We use essential storage to run the cart and remember your choices. With your permission we would also use analytics and marketing cookies. You can change this at any time in <a href="/policies/cookies/">Cookie settings</a>.</p>
  <div class="consent__actions">
    <button class="btn btn--ghost" type="button" data-consent="reject">Reject optional</button>
    <button class="btn btn--ghost" type="button" data-consent-open>Customise</button>
    <button class="btn btn--ghost" type="button" data-consent="accept">Accept all</button>
  </div>
</section>
<dialog class="modal" id="consent-modal" aria-labelledby="consent-modal-title">
  <form method="dialog" class="modal__inner" data-consent-form>
    <h2 id="consent-modal-title">Cookie settings</h2>
    <p class="muted small">Optional categories are off until you switch them on.</p>
    <div class="toggle-row"><div><strong>Strictly necessary</strong><p>Cart contents, checkout and this cookie choice. Always on.</p></div><span class="switch"><input type="checkbox" checked disabled aria-label="Strictly necessary (always on)"><span></span></span></div>
    <div class="toggle-row"><div><strong>Analytics</strong><p>Anonymous usage statistics that help us improve the site.</p></div><span class="switch"><input type="checkbox" name="analytics" aria-label="Analytics cookies"><span></span></span></div>
    <div class="toggle-row"><div><strong>Marketing</strong><p>Used to measure and personalise advertising.</p></div><span class="switch"><input type="checkbox" name="marketing" aria-label="Marketing cookies"><span></span></span></div>
    <div class="btn-row" style="margin-top:16px">
      <button class="btn" type="submit" value="save">Save choices</button>
      <button class="btn btn--ghost" type="submit" value="cancel" formnovalidate>Cancel</button>
    </div>
  </form>
</dialog>`;
}

function regionModal() {
  const currencies = Object.keys(MARKETS.currencies);
  return `
<dialog class="modal" id="region-modal" aria-labelledby="region-title">
  <form method="dialog" class="modal__inner" data-region-form>
    <h2 id="region-title">Region &amp; currency</h2>
    <div class="field"><label for="region-country">Shipping destination</label>
      <select class="input" id="region-country" name="country" data-country-select></select></div>
    <div class="field"><label for="region-currency">Currency</label>
      <select class="input" id="region-currency" name="currency">${currencies
        .map((c) => `<option value="${c}">${c} (${MARKETS.currencies[c].symbol})</option>`)
        .join('')}</select></div>
    <p class="muted small">We ship to ${txt(MARKETS.shippingCountries)}. ${txt(MARKETS.dutiesNotice)}</p>
    <div class="btn-row"><button class="btn" type="submit" value="save">Save</button><button class="btn btn--ghost" type="submit" value="cancel">Cancel</button></div>
  </form>
</dialog>`;
}

/** Data the client scripts need; nothing here is secret. */
export function clientData() {
  return {
    currency: cur,
    locale: MARKETS.currencies[cur].locale,
    product: {
      id: PRODUCT.variants[0].id,
      name: PRODUCT.fullName,
      variant: PRODUCT.variants[0].name,
      price: PRODUCT.price[cur],
      url: `/products/${PRODUCT.slug}/`,
      image: imageUrl('product', 480),
    },
    freeShippingThreshold: SHIPPING.freeShippingThreshold,
    bundle: OFFERS.bundle.enabled && OFFERS.bundle.percentOff ? OFFERS.bundle : null,
    checkoutUrl: STORE.integrations.checkoutUrl,
    newsletterEndpoint: STORE.integrations.newsletterEndpoint,
    contactFormEndpoint: STORE.integrations.contactFormEndpoint,
    trackingUrl: STORE.integrations.trackingUrl,
    analyticsScriptUrl: STORE.integrations.analyticsScriptUrl,
    supportEmail: STORE.supportEmail,
    returnWindow: RETURNS.window,
  };
}

export function layout({
  title,
  description,
  path,
  body,
  schema = [],
  scripts = [],
  ogImage = null,
  ogType = 'website',
  noindex = false,
  preload = null,
}) {
  const url = STORE.siteUrl.replace(/\/$/, '') + path;
  const fullTitle = path === '/' ? title : `${title} | ${STORE.brand}`;
  const ogPath = ogImage || imageUrl('ad', 1080) || imageUrl('hero-desktop', 1440) || '/assets/og.jpg';
  const og = /^https?:/.test(ogPath) ? ogPath : STORE.siteUrl.replace(/\/$/, '') + ogPath;
  return `<!doctype html>
<html lang="${STORE.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
${noindex ? '<meta name="robots" content="noindex, follow">' : ''}
<meta name="theme-color" content="#0a0c0f">
<meta name="color-scheme" content="dark">
<meta property="og:site_name" content="${STORE.brand}">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${og}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(fullTitle)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${og}">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@1&family=Manrope:wght@200;300;400;500;600&display=swap">
${preload || ''}
<link rel="stylesheet" href="/assets/main.css">
<script>document.documentElement.classList.add('js')</script>
${schema.map(jsonLd).join('\n')}
</head>
<body>
${header(path)}
<main id="main" tabindex="-1">
${body}
</main>
${footer()}
${drawer()}
${consent()}
${regionModal()}
<div class="toast" data-toast role="status" aria-live="polite"></div>
<script type="application/json" id="store-data">${JSON.stringify(clientData()).replace(/</g, '\\u003c')}</script>
<script src="/assets/app.js" defer></script>
${scripts.map((s) => `<script src="/assets/${s}.js" defer></script>`).join('\n')}
</body>
</html>`;
}

export const breadcrumbs = (items) =>
  `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items
    .map((it, i) =>
      i === items.length - 1
        ? `<li aria-current="page">${esc(it.name)}</li>`
        : `<li><a href="${it.path}">${esc(it.name)}</a></li>`,
    )
    .join('')}</ol></nav>`;

export const breadcrumbSchema = (items) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: it.name,
    item: STORE.siteUrl.replace(/\/$/, '') + it.path,
  })),
});

export const orgSchema = () => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: STORE.brand,
  url: STORE.siteUrl,
  logo: STORE.siteUrl.replace(/\/$/, '') + '/assets/logo.png',
  ...(STORE.socials.length ? { sameAs: STORE.socials.map((s) => s.url) } : {}),
});

export const pageHead = ({ crumbs, eyebrow, title, lead }) => `
<div class="page-head"><div class="wrap">
  ${crumbs ? breadcrumbs(crumbs) : ''}
  <p class="eyebrow" style="margin-top:28px">${esc(eyebrow)}</p>
  <h1 class="h2">${esc(title)}</h1>
  ${lead ? `<p class="lead">${txt(lead)}</p>` : ''}
</div></div>`;
