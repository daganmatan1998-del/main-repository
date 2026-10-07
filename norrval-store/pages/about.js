import { STORE, PRODUCT } from '../data/store.js';
import { ICONS } from '../components/icons.js';
import { picture, isReal } from '../components/picture.js';
import { layout, pageHead, breadcrumbSchema, orgSchema } from '../components/layout.js';

const CRUMBS = [
  { name: 'Home', path: '/' },
  { name: 'Our story', path: '/about/' },
];

export function aboutPage() {
  const principles = [
    ['Say only what is true.', 'If a specification is not confirmed by our manufacturer, we do not print it. No invented heritage, no borrowed prestige, no “was” prices that never were.'],
    ['Design for every day.', 'A watch you save for special occasions spends most of its life in a drawer. We design for the other 364 days.'],
    ['Make it ready to give.', 'Every Nocturne ships in a presentation box, because most good watches end up being a gift at some point.'],
  ];
  const body = `
${pageHead({ crumbs: CRUMBS, eyebrow: 'Our story', title: 'A quieter kind of statement.', lead: `${STORE.brand} makes modern watches for people who would rather be noticed for their taste than for their logo.` })}
<section class="section">
  <div class="wrap grid-2">
    <div>
      <h2 class="h3" data-reveal>Why we started</h2>
      <div class="prose" style="padding:16px 0 0">
        <p data-reveal>Most watches at this price try to look like something more expensive. We wanted the opposite: a watch that is honest about what it is and looks good because of it — dark, graphic, easy to wear.</p>
        <p data-reveal>Nocturne is our first. One colourway, one bracelet, one clear idea: black all the way through, with a single teal accent where your eye goes to read the time.</p>
        <p data-reveal><mark class="ph">[OPTIONAL: FOUNDER STORY — WHO STARTED ${STORE.brand}, WHERE, AND WHY. REPLACE OR DELETE THIS PARAGRAPH.]</mark></p>
      </div>
    </div>
    ${isReal('lifestyle') ? `<div class="frame frame--45" data-reveal="mask"><div class="mask-inner">${picture({ slot: 'lifestyle', sizes: '(min-width: 900px) 50vw, 100vw' })}</div></div>` : ''}
  </div>
</section>
<section class="section" style="padding-top:0">
  <div class="wrap">
    <p class="eyebrow" data-reveal>What we hold ourselves to</p>
    <div class="cards" style="margin-top:24px">
      ${principles.map(([t, p], i) => `<div class="card" data-reveal style="--d:${i * 0.08}s"><h3>${t}</h3><p>${p}</p></div>`).join('')}
    </div>
    <div class="btn-row" style="margin-top:48px">
      <a class="btn" href="/products/${PRODUCT.slug}/" data-magnetic>Shop Nocturne ${ICONS.arrow}</a>
      <a class="btn btn--ghost" href="/contact/">Get in touch</a>
    </div>
  </div>
</section>`;
  return layout({
    title: 'Our story',
    description: `Why ${STORE.brand} exists: modern, all-black watches designed for everyday wear, described honestly and delivered gift-ready.`,
    path: '/about/',
    body,
    schema: [orgSchema(), breadcrumbSchema(CRUMBS)],
  });
}
