/* NORRVAL — exploded-view diagram, inline in the homepage intro frame.
 *
 * No pinning: the frame scrolls normally, and GSAP ScrollTrigger just
 * reports how far it has travelled through the viewport (0 as it enters,
 * 1 as it leaves) via `scrub`. That single progress value drives every
 * part's position the same way the old full-screen version did — see
 * components/exploded-view.js for what each <g data-part> is and its own
 * --ax/--ay explode direction.
 */
(() => {
  'use strict';
  const el = document.querySelector('[data-xp-inline]');
  if (!el) return;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const parts = [...el.querySelectorAll('[data-part]')];

  // Extra pull for parts that should travel further than their neighbours.
  const DIST = { crystal: 150, strapTop: 165, strapBottom: 130, crown: 120, caseback: 135 };
  const defaultDist = 100;

  function paint(p) {
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; // easeInOutCubic
    for (const part of parts) {
      const ax = parseFloat(part.style.getPropertyValue('--ax')) || 0;
      const ay = parseFloat(part.style.getPropertyValue('--ay')) || 0;
      const name = part.dataset.part;
      const d = (DIST[name] ?? defaultDist) * e;
      part.style.setProperty('--tx', (ax * d).toFixed(1));
      part.style.setProperty('--ty', (ay * d).toFixed(1));
      part.style.setProperty('--rot', ((ax + ay) * 4 * e).toFixed(2));
      if (name === 'crystal') part.style.setProperty('--sc', (1 + e * 0.08).toFixed(3));
      else if (name === 'caseback') part.style.setProperty('--sc', (1 - e * 0.05).toFixed(3));
      if (name === 'springbars') part.style.setProperty('--op', (0.35 + e * 0.65).toFixed(2));
    }
    // Labels only mean anything once a part has visibly separated.
    el.style.setProperty('--labelOp', Math.max(0, Math.min(1, (e - 0.35) / 0.3)).toFixed(3));
  }

  if (reduce || !window.gsap || !window.ScrollTrigger) {
    // Reduced motion, or the vendor scripts didn't load: one still,
    // part-way-exploded frame — no scroll-jacking, no scrub.
    paint(0.5);
    return;
  }

  gsap.registerPlugin(ScrollTrigger);
  paint(0);
  ScrollTrigger.create({
    trigger: el,
    start: 'top 85%',
    end: 'bottom 25%',
    scrub: 0.3,
    onUpdate: (self) => paint(self.progress),
  });
})();
