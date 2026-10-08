import { STORE, PRODUCT, OFFERS, RETURNS, MARKETS, SHIPPING } from '../data/store.js';
import { REVIEWS } from '../data/reviews.js';
import { IMAGES } from '../data/images.js';
import { esc, txt, money } from '../utils/html.js';
import { ICONS } from '../components/icons.js';
import { picture, resolve, isReal, srcset, preloadFormat } from '../components/picture.js';
import { layout, orgSchema } from '../components/layout.js';
import { explodedDiagram } from '../components/exploded-view.js';
import { productSchema } from './product.js';

const cur = MARKETS.defaultCurrency;
const fmt = (n) => money(n, cur, MARKETS.currencies[cur].locale);
const PDP = `/products/${PRODUCT.slug}/`;

function hero() {
  return `
<section class="hero" aria-labelledby="hero-title">
  <div class="hero__media">
    ${picture({ slot: 'hero-desktop', mobileSlot: 'hero-mobile', priority: true })}
    <div class="hero__sweep" aria-hidden="true"></div>
  </div>
  <div class="wrap hero__content">
    <p class="eyebrow fade-up">${STORE.brand} — ${esc(PRODUCT.name)}</p>
    <h1 class="display" id="hero-title"><span class="split-line"><span>Time,</span></span><span class="split-line"><span>redefined.</span></span></h1>
    <p class="lead fade-up">A modern timepiece designed for those who move with purpose.</p>
    <div class="btn-row fade-up d2">
      <a class="btn" href="${PDP}" data-magnetic>Shop the watch ${ICONS.arrow}</a>
      <a class="btn btn--ghost" href="/about/" data-magnetic>Discover the story</a>
    </div>
  </div>
  <span class="hero__scroll" aria-hidden="true">Scroll</span>
</section>`;
}

function trust() {
  const items = [
    SHIPPING.tracked
      ? { icon: 'truck', title: 'Tracked shipping', body: 'Every order ships with tracking.', href: '/policies/shipping/' }
      : { icon: 'truck', title: 'Clear delivery times', body: 'Processing and transit shown by region.', href: '/policies/shipping/' },
    { icon: 'returns', title: `${RETURNS.window} returns`, body: 'Unworn, in original packaging.', href: '/policies/returns/' },
    { icon: 'lock', title: 'Secure checkout', body: 'Encrypted payment via a trusted provider.', href: '/faq/' },
    { icon: 'chat', title: 'Real support', body: `We reply ${STORE.responseTime}.`, href: '/contact/' },
  ];
  return `<div class="trust">${items
    .map(
      (i) =>
        `<a class="trust__item" href="${i.href}">${ICONS[i.icon]}<div><strong>${txt(i.title)}</strong><span>${txt(i.body)}</span></div></a>`,
    )
    .join('')}</div>`;
}

function intro() {
  const facts = PRODUCT.specifications.filter(([, v]) => v).slice(0, 4);
  return `
<section class="intro-pin" aria-labelledby="intro-title" data-xp-pin>
  <div class="intro-pin__sticky">
    <div class="wrap grid-2">
      <div class="frame frame--45" data-reveal="mask">
        <div class="mask-inner">${explodedDiagram()}</div>
      </div>
      <div>
        <p class="eyebrow" data-reveal>The Nocturne</p>
        <h2 class="h2" id="intro-title" data-reveal>Built to<br><span class="serif">stand out.</span></h2>
        <p class="lead" style="margin-top:28px" data-reveal>${esc(PRODUCT.description[0])}</p>
        <ul class="facts" data-reveal>
          ${facts.map(([k, v]) => `<li><span>${esc(k)}</span><span>${esc(v)}</span></li>`).join('')}
        </ul>
        <a class="link-arrow" href="${PDP}" data-reveal>View details ${ICONS.arrow}</a>
      </div>
    </div>
  </div>
</section>`;
}

function features() {
  return `
<section class="section" style="padding-top:0" aria-labelledby="features-title">
  <div class="wrap">
    <p class="eyebrow" data-reveal>Why Nocturne</p>
    <h2 class="h2" id="features-title" data-reveal>Less on the dial.<br><span class="serif">More on the wrist.</span></h2>
    <div class="features">
      ${PRODUCT.features
        .map(
          (f, i) => `
      <article class="feature" data-reveal style="--d:${i * 0.08}s" data-glow>
        <span class="feature__icon">${ICONS[f.icon]}</span>
        <span class="feature__num">0${i + 1}</span>
        <h3 class="h3">${esc(f.title)}</h3>
        <p>${esc(f.body)}</p>
      </article>`,
        )
        .join('')}
    </div>
  </div>
</section>`;
}

function cinematic() {
  // Scene images: each is a different, purpose-made shot. Missing shots are
  // skipped rather than repeated.
  const wanted = ['product', 'closeup', 'side'];
  const scenes = [...new Set(wanted.map((s) => resolve(s)).filter(Boolean))];
  if (!scenes.length) scenes.push('product');
  const steps = [
    { t: 'Black, all the way through.', p: 'Case, dial and bracelet share one finish, so the watch reads as a single, clean shape.' },
    { t: 'Colour only where it counts.', p: 'Teal on the hands and markers — the one detail that catches the light when you check the time.' },
    { t: 'Mesh that moves with you.', p: 'A fine black mesh bracelet that sits close to the wrist and works with everything you own.' },
  ];
  return `
<section class="cine" aria-label="Nocturne in detail" data-cine>
  <div class="cine__stage">
    <div class="cine__bg" aria-hidden="true"></div>
    <div class="cine__grid" aria-hidden="true"></div>
    <div class="cine__product">
      <div class="frame">
        ${scenes
          .map(
            (s, i) =>
              `<div class="cine__scene${i === 0 ? ' is-active' : ''}" data-scene>${picture({ slot: s, sizes: '(min-width: 900px) 46vw, 78vw' })}</div>`,
          )
          .join('')}
      </div>
      <div class="cine__light" aria-hidden="true"></div>
    </div>
    <div class="cine__steps">
      ${steps
        .map(
          (s, i) => `<div class="cine__step${i === 0 ? ' is-active' : ''}" data-step>
        <p class="eyebrow">0${i + 1} / 03</p>
        <h2 class="h2">${s.t}</h2>
        <p>${s.p}</p>
      </div>`,
        )
        .join('')}
    </div>
    <div class="cine__bar" aria-hidden="true"></div>
  </div>
</section>`;
}

function lifestyle() {
  const shots = [
    { slot: 'lifestyle', label: 'After hours', note: 'City, late' },
    { slot: 'business', label: 'At the desk', note: 'Workday' },
    { slot: 'wrist', label: 'Slow mornings', note: 'Weekend' },
  ].filter((s) => isReal(s.slot));
  return `
<section class="hscroll" aria-labelledby="life-title" data-hscroll>
  <div class="hscroll__pin">
    <div class="hscroll__track" data-track>
      <div class="panel panel--text">
        <p class="eyebrow">In the wild</p>
        <h2 class="h2" id="life-title">Made for<br><span class="serif">every moment.</span></h2>
        <p class="lead" style="margin-top:24px">From the first meeting to the last train home. Nocturne is dark enough to disappear under a cuff and sharp enough to be noticed when it doesn't.</p>
      </div>
      ${shots
        .map(
          (s) => `
      <figure class="panel" style="margin:0">
        <div class="frame">${picture({ slot: s.slot, sizes: '(min-width: 768px) 460px, 78vw' })}</div>
        <figcaption><strong>${s.label}</strong><span>${s.note}</span></figcaption>
      </figure>`,
        )
        .join('')}
      <div class="panel panel--text">
        <h3 class="h3">One watch. Every outfit.</h3>
        <p class="muted">Black on black goes with everything — which is exactly the point.</p>
        <a class="link-arrow" href="${PDP}">Shop Nocturne ${ICONS.arrow}</a>
      </div>
    </div>
  </div>
</section>`;
}

function owners() {
  if (REVIEWS.length) {
    return `
<section class="section owners" aria-labelledby="owners-title">
  <div class="wrap">
    <p class="eyebrow">From owners</p>
    <h2 class="h2" id="owners-title">What owners say.</h2>
    <div class="reviews">${REVIEWS.map(
      (r) =>
        `<figure class="review" style="margin:0"><blockquote style="margin:0">${esc(r.text)}</blockquote><figcaption class="muted small" style="margin-top:16px">${esc(r.name)}${r.verified ? ' · Verified buyer' : ''}${r.date ? ` · ${esc(r.date)}` : ''}</figcaption></figure>`,
    ).join('')}</div>
  </div>
</section>`;
  }
  return `
<section class="section owners" aria-labelledby="owners-title">
  <div class="wrap">
    <p class="eyebrow" data-reveal>New for ${new Date().getFullYear()}</p>
    <h2 class="h2" id="owners-title" data-reveal>Join the first generation of <span class="serif">NORRVAL</span> owners.</h2>
    <p class="lead" data-reveal>Nocturne is our first watch. Wear it, then tell us honestly what you think — every message reaches a real person, and it shapes what we make next.</p>
    <div class="btn-row" style="justify-content:center" data-reveal>
      <a class="btn" href="${PDP}" data-magnetic>Shop Nocturne ${ICONS.arrow}</a>
      <a class="btn btn--ghost" href="/contact/">Talk to us</a>
    </div>
  </div>
</section>`;
}

function offer() {
  const L = OFFERS.launch;
  const B = OFFERS.bundle;
  const price = PRODUCT.price[cur];
  const compare = PRODUCT.compareAtPrice?.[cur];
  const head = L.enabled && L.headline ? esc(L.headline) : 'One price.<br><span class="serif">Everything in the box.</span>';
  const body =
    L.enabled && L.body
      ? txt(L.body)
      : 'No inflated “was” prices and no countdowns. Nocturne costs what it costs, and it arrives with everything you see below.';
  return `
<section class="section" aria-labelledby="offer-title">
  <div class="wrap">
    <div class="offer" data-reveal>
      <div style="position:relative;z-index:1">
        <p class="eyebrow">${L.enabled ? esc(L.label) : 'Introducing Nocturne'}</p>
        <h2 class="h2" id="offer-title" style="font-size:clamp(32px,4.4vw,60px)">${head}</h2>
        <p class="lead" style="margin:24px 0 32px">${body}</p>
        ${L.enabled && L.code ? `<p>Use code <span class="code-chip">${esc(L.code)}</span> at checkout.${L.endsOn ? ` Offer ends ${esc(new Date(L.endsOn).toLocaleDateString('en-US', { dateStyle: 'long' }))}.` : ''}</p>` : ''}
        ${B.enabled && B.percentOff ? `<p class="muted">Buying for two? Add ${B.quantity} to your cart and ${B.percentOff}% comes off automatically.</p>` : ''}
        <div class="price-big" aria-label="Price ${fmt(price)}">${fmt(price)}${compare ? `<s>${fmt(compare)}</s>` : ''}</div>
        <p class="muted small" style="margin:10px 0 28px">Taxes and shipping calculated at checkout.</p>
        <a class="btn" href="${PDP}" data-magnetic>Shop the watch ${ICONS.arrow}</a>
      </div>
      <ul class="checklist">
        ${PRODUCT.inTheBox.map((i) => `<li>${ICONS.check}<span>${txt(i)}</span></li>`).join('')}
        <li>${ICONS.check}<span>${txt(RETURNS.window)} returns on unworn watches</span></li>
        <li>${ICONS.check}<span>${SHIPPING.tracked ? 'Tracked shipping' : 'Shipping'} to ${txt(MARKETS.shippingCountries)}</span></li>
        <li>${ICONS.check}<span>Warranty: ${txt(RETURNS.warranty)}</span></li>
      </ul>
    </div>
  </div>
</section>`;
}

function gifting() {
  return `
<section class="section gift" id="gift" aria-labelledby="gift-title">
  <div class="wrap grid-2">
    <div>
      <p class="eyebrow" data-reveal>Gifting</p>
      <h2 class="h2" id="gift-title" data-reveal>The gift that<br><span class="serif">says more.</span></h2>
      <p class="lead" style="margin:28px 0" data-reveal>Nocturne ships in a black presentation box with a matching beaded bracelet, so it is ready to give the moment it arrives. Send it straight to them — just add their address at checkout.</p>
      <ul class="pdp__assure" data-reveal>
        <li>${ICONS.gift}<span>Presentation box included with every order</span></li>
        <li>${ICONS.returns}<span>Returns accepted within ${txt(RETURNS.window)} — see <a href="/policies/returns/">policy</a> for gift returns</span></li>
      </ul>
      <a class="btn" href="${PDP}" data-reveal data-magnetic>Shop now ${ICONS.arrow}</a>
    </div>
    <div class="frame frame--45" data-reveal="mask">
      <div class="mask-inner">${picture({ slot: 'gift', sizes: '(min-width: 900px) 50vw, 100vw' })}</div>
    </div>
  </div>
</section>`;
}

function finalCta() {
  const s = resolve('product');
  return `
<section class="final" aria-labelledby="final-title">
  ${s ? `<div class="final__watch" aria-hidden="true" data-parallax="0.12">${picture({ slot: 'product', sizes: '520px', alt: '' })}</div>` : ''}
  <div class="final__rings" aria-hidden="true">${[260, 420, 580, 740].map((r, i) => `<span style="--r:${r};--dl:${i * -3}s"></span>`).join('')}</div>
  <div class="final__content">
    <p class="eyebrow" data-reveal>${STORE.brand}</p>
    <h2 class="display" id="final-title" data-reveal="blur">Your time<br>starts now.</h2>
    <p class="lead" data-reveal>Nocturne, ${fmt(PRODUCT.price[cur])}. Ships in its presentation box.</p>
    <a class="btn" href="${PDP}" data-reveal data-magnetic>Shop the collection ${ICONS.arrow}</a>
  </div>
</section>`;
}

export function homePage() {
  const heroPreload = (() => {
    const d = resolve('hero-desktop');
    const m = resolve('hero-mobile');
    if (!d) return '';
    // Preload only the AVIF the browser will actually pick.
    const tag = (slot, media) =>
      `<link rel="preload" as="image" type="image/${preloadFormat(slot)}" imagesrcset="${srcset(slot, preloadFormat(slot))}" imagesizes="100vw" media="${media}" fetchpriority="high">`;
    return m && m !== d
      ? tag(m, '(max-width: 767px)') + tag(d, '(min-width: 768px)')
      : tag(d, 'all');
  })();
  return layout({
    title: `${STORE.brand} — The Nocturne all-black mesh watch`,
    description: `Meet Nocturne by ${STORE.brand}: a matte black watch with a black dial, teal-accented hands and a black mesh bracelet. Gift-boxed. ${fmt(PRODUCT.price[cur])}.`,
    path: '/',
    body: hero() + trust() + intro() + features() + cinematic() + lifestyle() + owners() + offer() + gifting() + finalCta(),
    schema: [
      orgSchema(),
      { '@context': 'https://schema.org', '@type': 'WebSite', name: STORE.brand, url: STORE.siteUrl },
      productSchema(),
    ],
    scripts: ['home', 'vendor/gsap.min', 'vendor/ScrollTrigger.min', 'exploded'],
    preload: heroPreload,
  });
}
