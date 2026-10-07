import { STORE, PRODUCT, OFFERS, RETURNS, SHIPPING, MARKETS, FAQ } from '../data/store.js';
import { REVIEWS } from '../data/reviews.js';
import { IMAGES } from '../data/images.js';
import { esc, txt, money } from '../utils/html.js';
import { ICONS } from '../components/icons.js';
import { picture, resolve, isReal, imageUrl } from '../components/picture.js';
import { layout, breadcrumbs, breadcrumbSchema } from '../components/layout.js';

const cur = MARKETS.defaultCurrency;
const fmt = (n) => money(n, cur, MARKETS.currencies[cur].locale);
const PATH = `/products/${PRODUCT.slug}/`;
const CRUMBS = [
  { name: 'Home', path: '/' },
  { name: PRODUCT.name, path: PATH },
];

/** Gallery: only real, distinct shots — never the same image twice. */
const GALLERY = ['product', 'closeup', 'side', 'wrist', 'lifestyle', 'business', 'gift'];
const gallerySlots = () => GALLERY.filter(isReal);

export function productSchema() {
  const price = PRODUCT.price[cur];
  const images = gallerySlots().map((s) => {
    const u = imageUrl(s, 1440);
    return /^https?:/.test(u) ? u : STORE.siteUrl.replace(/\/$/, '') + u;
  });
  const specs = PRODUCT.specifications.filter(([, v]) => v);
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: PRODUCT.fullName,
    description: PRODUCT.shortDescription,
    brand: { '@type': 'Brand', name: STORE.brand },
    ...(PRODUCT.sku && !PRODUCT.sku.startsWith('[') ? { sku: PRODUCT.sku } : {}),
    ...(PRODUCT.gtin ? { gtin: PRODUCT.gtin } : {}),
    color: 'Black',
    ...(images.length ? { image: images } : {}),
    additionalProperty: specs.map(([name, value]) => ({ '@type': 'PropertyValue', name, value })),
    offers: {
      '@type': 'Offer',
      url: STORE.siteUrl.replace(/\/$/, '') + PATH,
      priceCurrency: cur,
      price: price.toFixed(2),
      availability: `https://schema.org/${PRODUCT.availability}`,
      itemCondition: 'https://schema.org/NewCondition',
    },
  };
}

function gallery() {
  const slots = gallerySlots();
  if (!slots.length) {
    return `<div class="gallery"><div class="gallery__main">${picture({ slot: 'product' })}</div></div>`;
  }
  return `
<div class="gallery" data-gallery aria-roledescription="carousel" aria-label="Product images">
  <div class="gallery__main">
    ${slots
      .map(
        (s, i) =>
          `<div class="gallery__slide${i === 0 ? ' is-active' : ''}" data-slide data-fit="${IMAGES[s].ratio[0] === IMAGES[s].ratio[1] ? 'contain' : 'cover'}" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${slots.length}"${i ? ' aria-hidden="true"' : ''}>${picture({
            slot: s,
            sizes: '(min-width: 1000px) 55vw, 100vw',
            priority: i === 0,
          })}</div>`,
      )
      .join('')}
    ${
      slots.length > 1
        ? `<div class="gallery__nav"><button class="icon-btn" type="button" aria-label="Previous image" data-prev>${ICONS.left}</button><button class="icon-btn" type="button" aria-label="Next image" data-next>${ICONS.right}</button></div>`
        : ''
    }
  </div>
  ${
    slots.length > 1
      ? `<div class="gallery__thumbs">${slots
          .map(
            (s, i) =>
              `<button class="gallery__thumb" type="button" data-thumb="${i}" aria-label="Show image ${i + 1}: ${esc(IMAGES[s].alt)}" aria-current="${i === 0}"><img src="${imageUrl(s, 480)}" alt="" width="80" height="80" loading="lazy" decoding="async"></button>`,
          )
          .join('')}</div>`
      : ''
  }
</div>`;
}

function info() {
  const price = PRODUCT.price[cur];
  const compare = PRODUCT.compareAtPrice?.[cur];
  const save = compare && compare > price ? Math.round((1 - price / compare) * 100) : 0;
  const v = PRODUCT.variants;
  const soldOut = PRODUCT.availability === 'OutOfStock';
  return `
<div class="pdp__info">
  ${breadcrumbs(CRUMBS)}
  <h1 style="margin-top:20px">${esc(PRODUCT.name)}</h1>
  <p class="pdp__sub">${esc(PRODUCT.subtitle)} · ${STORE.brand}</p>
  <div class="pdp__price"><span data-price>${fmt(price)}</span>${compare && save > 0 ? `<s>${fmt(compare)}</s><span class="save">Save ${save}%</span>` : ''}</div>
  <p class="pdp__tax">Taxes and shipping calculated at checkout. International orders may be subject to import duties.</p>
  ${OFFERS.launch.enabled && OFFERS.launch.body ? `<p class="notice">${txt(OFFERS.launch.body)}</p>` : ''}
  <p class="muted" style="margin:0 0 24px">${esc(PRODUCT.shortDescription)}</p>

  <form data-buy novalidate>
    <span class="label" id="variant-label">Colour — <span data-variant-name>${esc(v[0].name)}</span></span>
    <div class="swatches" role="radiogroup" aria-labelledby="variant-label">
      ${v
        .map(
          (x, i) =>
            `<button class="swatch" type="button" role="radio" aria-checked="${i === 0}" data-variant="${x.id}" data-variant-label="${esc(x.name)}"${x.available ? '' : ' disabled'}><i aria-hidden="true"></i>${esc(x.name)}</button>`,
        )
        .join('')}
    </div>
    <label class="label" for="qty">Quantity</label>
    <div class="buy-row" style="margin-top:10px" data-atc-anchor>
      <div class="qty"><button type="button" aria-label="Decrease quantity" data-qty="-1">−</button><input id="qty" name="qty" type="number" inputmode="numeric" min="1" max="10" value="1"><button type="button" aria-label="Increase quantity" data-qty="1">+</button></div>
      <button class="btn" type="submit" data-add${soldOut ? ' disabled' : ''}>${soldOut ? 'Sold out' : 'Add to cart'}</button>
    </div>
    <button class="btn btn--ghost btn--block buy-now" type="button" data-buy-now${soldOut ? ' disabled' : ''}>Buy now</button>
  </form>

  <ul class="pdp__assure">
    <li>${ICONS.truck}<span>Ships in ${txt(SHIPPING.processingTime)}, then ${SHIPPING.tracked ? 'tracked ' : ''}delivery. <a href="/policies/shipping/">Delivery times</a></span></li>
    <li>${ICONS.returns}<span>${txt(RETURNS.window)} returns on unworn watches. <a href="/policies/returns/">Returns policy</a></span></li>
    <li>${ICONS.lock}<span>Secure checkout. ${esc(STORE.payments.accepted.join(', '))}.</span></li>
    <li>${ICONS.gift}<span>Arrives in its black presentation box.</span></li>
  </ul>

  <div class="acc">
    <details open><summary>Description</summary><div class="acc__body">${PRODUCT.description.map((p) => `<p>${esc(p)}</p>`).join('')}</div></details>
    <details><summary>Specifications</summary><div class="acc__body">
      <table class="spec-table"><tbody>${PRODUCT.specifications
        .filter(([, val]) => val)
        .map(([k, val]) => `<tr><th scope="row">${esc(k)}</th><td>${txt(val)}</td></tr>`)
        .join('')}</tbody></table>
      <p class="spec-note">We list only specifications confirmed by our manufacturer. Need a figure that isn't here? <a href="/contact/">Ask us</a>.</p>
    </div></details>
    <details><summary>What's in the box</summary><div class="acc__body"><ul style="margin:0;padding-left:18px">${PRODUCT.inTheBox.map((i) => `<li>${txt(i)}</li>`).join('')}</ul></div></details>
    <details><summary>Shipping</summary><div class="acc__body">
      <p><strong>Processing:</strong> ${txt(SHIPPING.processingTime)}. <strong>Transit:</strong> depends on destination. <strong>Estimated delivery</strong> = processing + transit.</p>
      <p>We ship to ${txt(MARKETS.shippingCountries)}. ${txt(MARKETS.dutiesNotice)}</p>
      <p><a href="/policies/shipping/">Full shipping policy</a></p>
    </div></details>
    <details><summary>Returns &amp; warranty</summary><div class="acc__body">
      <p>Return an unworn watch in its original packaging within ${txt(RETURNS.window)} of delivery. ${txt(RETURNS.returnShippingPaidBy)}.</p>
      <p><strong>Warranty:</strong> ${txt(RETURNS.warranty)}</p>
      <p><a href="/policies/returns/">Full returns policy</a></p>
    </div></details>
    <details><summary>Payment</summary><div class="acc__body">
      <p>We accept ${esc(STORE.payments.accepted.join(', '))}.</p>
      <p>${txt(STORE.payments.note)}</p>
    </div></details>
  </div>
</div>`;
}

function productFaq() {
  const items = FAQ.slice(0, 6);
  return `
<section class="section pdp-story" aria-labelledby="pfaq-title">
  <div class="wrap grid-2" style="align-items:start">
    <div>
      <p class="eyebrow">Questions</p>
      <h2 class="h2" id="pfaq-title">Before<br><span class="serif">you buy.</span></h2>
      <p class="lead" style="margin-top:24px">Can't find your answer? <a href="/contact/">Contact support</a> — ${txt(STORE.responseTime)}.</p>
    </div>
    <div class="acc">${items
      .map((f) => `<details><summary>${esc(f.q)}</summary><div class="acc__body"><p>${txt(f.a)}</p></div></details>`)
      .join('')}
      <p style="margin-top:20px"><a class="link-arrow" href="/faq/">All questions ${ICONS.arrow}</a></p>
    </div>
  </div>
</section>`;
}

function reviewsBlock() {
  if (!REVIEWS.length) return '';
  return `
<section class="section pdp-story" aria-labelledby="rev-title"><div class="wrap">
  <h2 class="h2" id="rev-title">Reviews</h2>
  <div class="reviews">${REVIEWS.map(
    (r) =>
      `<figure class="review" style="margin:0"><blockquote style="margin:0">${esc(r.text)}</blockquote><figcaption class="muted small" style="margin-top:16px">${esc(r.name)}${r.verified ? ' · Verified buyer' : ''}</figcaption></figure>`,
  ).join('')}</div>
</div></section>`;
}

function story() {
  const slot = isReal('wrist') ? 'wrist' : isReal('lifestyle') ? 'lifestyle' : null;
  if (!slot) return '';
  return `
<section class="section pdp-story" aria-labelledby="pstory-title">
  <div class="wrap grid-2">
    <div class="frame frame--45" data-reveal="mask">${picture({ slot, sizes: '(min-width: 900px) 50vw, 100vw' })}</div>
    <div>
      <p class="eyebrow" data-reveal>On the wrist</p>
      <h2 class="h2" id="pstory-title" data-reveal>Dark by design.</h2>
      <p class="lead" style="margin-top:24px" data-reveal>${esc(PRODUCT.description[1])}</p>
    </div>
  </div>
</section>`;
}

function stickyBar() {
  const soldOut = PRODUCT.availability === 'OutOfStock';
  return `
<div class="sticky-atc" data-sticky-atc aria-hidden="true">
  <div class="sticky-atc__info"><strong>${esc(PRODUCT.fullName)}</strong><span class="muted">${fmt(PRODUCT.price[cur])}</span></div>
  <button class="btn" type="button" data-sticky-add tabindex="-1"${soldOut ? ' disabled' : ''}>${soldOut ? 'Sold out' : 'Add to cart'}</button>
</div>`;
}

export function productPage() {
  return layout({
    title: `${PRODUCT.name} — All-Black Mesh Watch`,
    description: `${PRODUCT.fullName}: matte black watch with a black dial, teal-accented hands and a black mesh bracelet. Gift box included. ${fmt(PRODUCT.price[cur])}. ${RETURNS.window.startsWith('[') ? '' : RETURNS.window + ' returns.'}`.trim(),
    path: PATH,
    ogType: 'product',
    ogImage: imageUrl('product', 1080),
    body: `<div class="wrap"><div class="pdp">${gallery()}${info()}</div></div>${story()}${reviewsBlock()}${productFaq()}${stickyBar()}`,
    schema: [productSchema(), breadcrumbSchema(CRUMBS)],
    scripts: ['product'],
  });
}
