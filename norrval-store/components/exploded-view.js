/**
 * Scroll-driven exploded-view diagram of the watch: SVG line-art, 13
 * independently animated parts, built from the real component list (case,
 * crystal, dial, hands, sub-dial, movement, crown, case back, mesh strap,
 * spring bars, screws). No photo and no video — every part is a real DOM
 * node whose position the scroll script controls directly.
 *
 * The geometry is original line-art in the site's own palette; it does not
 * reproduce any supplied reference image. Deliberately carries no brand text
 * (illegible at this scale, and keeps the component brand-neutral).
 *
 * Sits inline in the homepage intro's image frame (next to "Built to stand
 * out."), not as its own full-screen section — so it has no headline/caption
 * of its own, and it scrubs as the frame scrolls through view rather than
 * pinning the page. Markup only; motion lives in assets/js/exploded.js.
 */

// A thin radial gradient "glass" look reused by the crystal and case rings.
const defs = `<defs>
  <radialGradient id="xpGlass" cx="32%" cy="26%" r="70%">
    <stop offset="0%" stop-color="#d9f6f9" stop-opacity=".16"/>
    <stop offset="35%" stop-color="#3fb8c9" stop-opacity=".045"/>
    <stop offset="100%" stop-color="#3fb8c9" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="xpSteel" cx="40%" cy="35%" r="70%">
    <stop offset="0%" stop-color="#4a525c"/>
    <stop offset="100%" stop-color="#1a1e24"/>
  </radialGradient>
  <filter id="xpGlow" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur stdDeviation="3" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>`;

const markers = (r, step = 30) =>
  Array.from({ length: 12 }, (_, i) => {
    const a = (i * step * Math.PI) / 180;
    const x1 = Math.sin(a) * (r - 10), y1 = -Math.cos(a) * (r - 10);
    const x2 = Math.sin(a) * r, y2 = -Math.cos(a) * r;
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#3fb8c9" stroke-width="${i % 3 === 0 ? 2.6 : 1.4}" stroke-linecap="round"/>`;
  }).join('');

const screw = (x, y) =>
  `<g transform="translate(${x} ${y})"><circle r="5.5" fill="url(#xpSteel)" stroke="#000" stroke-opacity=".4"/><line x1="-3" y1="0" x2="3" y2="0" stroke="#0c0e11" stroke-width="1.4"/></g>`;

/**
 * A label + leader line for one part, drawn outward along that part's own
 * explode direction (ax, ay — the same numbers set on the <g>'s --ax/--ay,
 * passed in here too so the two never drift apart). `r` is roughly that
 * part's own radius, so the leader starts at its edge, not its center.
 */
const leader = (ax, ay, r, text) => {
  const m = Math.hypot(ax, ay) || 1;
  const nx = ax / m, ny = ay / m;
  const pad = 22;
  const x1 = nx * r, y1 = ny * r;
  const x2 = nx * (r + pad), y2 = ny * (r + pad);
  const anchor = nx < -0.25 ? 'end' : nx > 0.25 ? 'start' : 'middle';
  const tx = x2 + (anchor === 'end' ? -5 : anchor === 'start' ? 5 : 0);
  return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="xp__leader"/><text x="${tx.toFixed(1)}" y="${(y2 + 3).toFixed(1)}" text-anchor="${anchor}" class="xp__label">${text}</text>`;
};
/** Crown sits off-centre already (local x≈118–180), so it gets its own fixed label instead of a radial leader. */
const crownLabel = `<line x1="160" y1="20" x2="178" y2="32" class="xp__leader"/><text x="183" y="36" text-anchor="start" class="xp__label">CROWN</text>`;

export function explodedViewSVG() {
  return `<svg class="xp__svg" viewBox="-380 -380 760 760" aria-hidden="true">
<!-- decorative: the wrapping element (components/exploded-view.js) carries the real label -->

${defs}
<g class="xp__part" data-part="strapTop" style="--ax:0;--ay:-1">
  <rect x="-46" y="-230" width="92" height="110" rx="10" fill="#0c0e11" stroke="#262c33"/>
  ${Array.from({ length: 9 }, (_, i) => `<rect x="-40" y="${-224 + i * 12}" width="80" height="7" rx="3" fill="#15181c"/>`).join('')}
  ${leader(0, -1, 232, 'MESH STRAP')}
</g>
<g class="xp__part" data-part="strapBottom" style="--ax:0;--ay:1">
  <rect x="-46" y="120" width="92" height="110" rx="10" fill="#0c0e11" stroke="#262c33"/>
  ${Array.from({ length: 9 }, (_, i) => `<rect x="-40" y="${126 + i * 12}" width="80" height="7" rx="3" fill="#15181c"/>`).join('')}
</g>
<g class="xp__part" data-part="springbars" style="--ax:-0.6;--ay:0.8">
  <rect x="-54" y="97" width="30" height="5" rx="2.5" fill="url(#xpSteel)"/>
  <rect x="24" y="97" width="30" height="5" rx="2.5" fill="url(#xpSteel)"/>
  ${leader(-0.6, 0.8, 42, 'SPRING BAR')}
</g>
<g class="xp__part" data-part="caseback" style="--ax:1;--ay:0.15">
  <circle r="108" fill="#101317" stroke="#2b323b" stroke-width="2"/>
  <circle r="90" fill="none" stroke="#1d232a" stroke-width="1"/>
  <text y="42" text-anchor="middle" font-family="Manrope, sans-serif" font-size="13" letter-spacing="2" fill="#565f69">STAINLESS STEEL</text>
  <text y="56" text-anchor="middle" font-family="Manrope, sans-serif" font-size="13" letter-spacing="2" fill="#565f69">5 ATM</text>
  ${[[-70, -70], [70, -70], [-70, 70], [70, 70]].map(([x, y]) => screw(x, y)).join('')}
  ${leader(1, 0.15, 108, 'CASE BACK')}
</g>
<g class="xp__part" data-part="movement" style="--ax:0.35;--ay:0.15">
  <circle r="86" fill="url(#xpSteel)" stroke="#333b45"/>
  <circle r="86" fill="none" stroke="#3fb8c9" stroke-opacity=".25" stroke-width="1"/>
  <circle r="30" cy="-10" fill="none" stroke="#3fb8c9" stroke-opacity=".5" stroke-width="6"/>
  <circle cx="34" cy="26" r="16" fill="#0c0e11" stroke="#333b45"/>
  <circle cx="-36" cy="30" r="11" fill="#0c0e11" stroke="#333b45"/>
  ${[[-50, -40], [48, -46], [-10, 60]].map(([x, y]) => screw(x, y)).join('')}
  ${leader(0.35, 0.15, 150, 'MOVEMENT')}
</g>
<g class="xp__part" data-part="caseRing" style="--ax:0.9;--ay:-0.25">
  <circle r="118" fill="none" stroke="url(#xpSteel)" stroke-width="16"/>
  <circle r="118" fill="none" stroke="#3fb8c9" stroke-opacity=".18" stroke-width="1"/>
  <circle r="110" fill="none" stroke="#070809" stroke-width="2"/>
  ${leader(0.9, -0.25, 126, 'CASE')}
</g>
<g class="xp__part" data-part="crown" style="--ax:1.6;--ay:0.3">
  <rect x="118" y="-10" width="30" height="20" rx="4" fill="url(#xpSteel)"/>
  <g transform="translate(160 0)">
    <circle r="16" fill="url(#xpSteel)" stroke="#444c56"/>
    ${Array.from({ length: 10 }, (_, i) => `<line x1="${(16 * Math.cos((i * 36 * Math.PI) / 180)).toFixed(1)}" y1="${(16 * Math.sin((i * 36 * Math.PI) / 180)).toFixed(1)}" x2="${(20 * Math.cos((i * 36 * Math.PI) / 180)).toFixed(1)}" y2="${(20 * Math.sin((i * 36 * Math.PI) / 180)).toFixed(1)}" stroke="#20252b" stroke-width="2"/>`).join('')}
  </g>
  ${crownLabel}
</g>
<g class="xp__part" data-part="dateWheel" style="--ax:0.05;--ay:0.98">
  <circle r="58" fill="#0a0c0f" stroke="#262c33"/>
  <text y="30" text-anchor="middle" font-family="Manrope, sans-serif" font-size="17" fill="#3fb8c9">8</text>
  ${leader(0.05, 0.98, 58, 'DATE WHEEL')}
</g>
<g class="xp__part" data-part="subdial" style="--ax:-0.45;--ay:0.55">
  <circle r="40" fill="#0d1014" stroke="#3fb8c9" stroke-opacity=".4"/>
  ${markers(36, 45)}
  <line x1="0" y1="0" x2="0" y2="-26" stroke="#3fb8c9" stroke-width="2.4" stroke-linecap="round"/>
  ${leader(-0.45, 0.55, 40, 'SUB-DIAL')}
</g>
<g class="xp__part" data-part="dial" style="--ax:-1;--ay:-0.1">
  <circle r="102" fill="#0b0d10" stroke="#20252b"/>
  ${markers(96)}
  <circle r="2.4" fill="#eceef0"/>
  ${leader(-1, -0.1, 102, 'DIAL')}
</g>
<g class="xp__part" data-part="hourHand" style="--ax:-0.2;--ay:-0.5">
  <line x1="0" y1="0" x2="-28" y2="-30" stroke="#eceef0" stroke-width="4" stroke-linecap="round"/>
</g>
<g class="xp__part" data-part="minuteHand" style="--ax:0.15;--ay:-0.75">
  <line x1="0" y1="0" x2="40" y2="-66" stroke="#3fb8c9" stroke-width="3.4" stroke-linecap="round"/>
  ${leader(0.15, -0.75, 68, 'HANDS')}
</g>
<g class="xp__part" data-part="crystal" style="--ax:-1.5;--ay:-0.85">
  <circle r="122" fill="url(#xpGlass)"/>
  <circle r="122" fill="none" stroke="#bdeef5" stroke-opacity=".22" stroke-width="1"/>
  <path d="M -80 -80 A 150 150 0 0 1 20 -118" fill="none" stroke="#eaf9fb" stroke-opacity=".65" stroke-width="2.5" stroke-linecap="round" filter="url(#xpGlow)"/>
  ${leader(-1.5, -0.85, 122, 'CRYSTAL')}
</g>
</svg>`;
}

/**
 * Compact version: fills whatever frame it's dropped into (sized by the
 * caller's CSS — here, the homepage intro's `.frame.frame--45`). As that
 * frame scrolls through the viewport, the watch separates into its parts;
 * scrolling back up reassembles it. No pinning, no headline of its own —
 * it sits next to "Built to stand out.", which already carries that copy.
 */
export function explodedDiagram() {
  return `<div class="xp-inline" data-xp-inline role="img" aria-label="Animated exploded diagram of the Nocturne watch, separating into the crystal, dial, hands, sub-dial, movement, case, crown, case back, spring bars and mesh bracelet as the page scrolls">${explodedViewSVG()}</div>`;
}
