/* NORRVAL — exploded-view diagram (product page only).
 *
 * Scroll position drives a single progress value (0..1) via GSAP
 * ScrollTrigger; `.xp__pin` does the actual pinning with plain CSS
 * `position: sticky`, so ScrollTrigger here only reports progress — no
 * pin-spacer, nothing fighting the rest of the page's layout.
 *
 * Each <g data-part> carries its own explode direction as --ax/--ay (set
 * inline in the SVG, components/exploded-view.js). This script just scales
 * that direction by the current progress and writes --tx/--ty/--rot/--sc/--op
 * as CSS custom properties, which do the actual (GPU-composited) transform.
 * Retune a part's explode distance in DIST below, or its direction at the
 * source (the --ax/--ay on that <g> in exploded-view.js).
 */
(() => {
  'use strict';
  const section = document.querySelector('[data-xp]');
  if (!section) return;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const parts = [...section.querySelectorAll('[data-part]')];
  const lines = [...section.querySelectorAll('[data-xp-line]')];
  const bar = section.querySelector('[data-xp-bar]');
  const stage = section.querySelector('[data-xp-stage]');

  // Extra pull for parts that should travel further than their neighbours
  // (the crystal lifts clear of the dial; the mesh strap clears the lugs).
  const DIST = { crystal: 190, strapTop: 210, strapBottom: 165, crown: 150, caseback: 170 };
  const defaultDist = 130;

  function paint(p) {
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; // easeInOutCubic
    for (const part of parts) {
      const ax = parseFloat(part.style.getPropertyValue('--ax')) || 0;
      const ay = parseFloat(part.style.getPropertyValue('--ay')) || 0;
      const name = part.dataset.part;
      const d = (DIST[name] ?? defaultDist) * e;
      part.style.setProperty('--tx', (ax * d).toFixed(1));
      part.style.setProperty('--ty', (ay * d).toFixed(1));
      part.style.setProperty('--rot', ((ax + ay) * 5 * e).toFixed(2));
      if (name === 'crystal') part.style.setProperty('--sc', (1 + e * 0.1).toFixed(3));
      else if (name === 'caseback') part.style.setProperty('--sc', (1 - e * 0.06).toFixed(3));
      if (name === 'springbars' || name === 'screws') part.style.setProperty('--op', (0.35 + e * 0.65).toFixed(2));
    }
    if (stage) stage.style.transform = `rotate(${(-1.5 * e).toFixed(2)}deg) scale(${(1 + e * 0.03).toFixed(3)})`;
    if (bar) bar.parentElement.style.setProperty('--p', e.toFixed(3));

    const stepFor = (i) => (i === 0 ? p < 0.22 : i === 1 ? p >= 0.32 && p < 0.68 : p >= 0.78);
    lines.forEach((el, i) => el.classList.toggle('is-on', stepFor(i)));
  }

  function staticFallback() {
    section.classList.add('is-static');
    paint(0.55);
    lines.forEach((el) => el.classList.toggle('is-on', el.dataset.xpLine === '1'));
  }

  if (reduce || !window.gsap || !window.ScrollTrigger) {
    staticFallback();
    return;
  }

  gsap.registerPlugin(ScrollTrigger);
  paint(0);
  ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: 'bottom bottom',
    scrub: 0.4,
    onUpdate: (self) => paint(self.progress),
  });
})();
