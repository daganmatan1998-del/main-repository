/* NORRVAL — exploded-view diagram, pinned in the homepage intro.
 *
 * `.intro-pin` freezes via plain CSS `position: sticky` (see main.css) —
 * GSAP ScrollTrigger here only reports how far the user has scrolled
 * through that pinned section's extra height (0 at the top, 1 at the
 * bottom) via `scrub`, and that single progress value drives every part's
 * position. See components/exploded-view.js for what each <g data-part>
 * is and its own --ax/--ay explode direction.
 */
(() => {
  'use strict';
  const section = document.querySelector('[data-xp-pin]');
  const el = document.querySelector('[data-xp-inline]');
  if (!section || !el) return;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Below 900px the intro's grid-2 stacks the diagram frame and the text
  // column into one, so both have to share the pinned 100vh/100svh box —
  // together they don't fit, and the sticky container's `overflow: hidden`
  // crops whichever part doesn't. Pinning only works once they're side by
  // side (see the matching @media (min-width: 900px) in main.css), so mobile
  // gets the same static fallback as reduced-motion instead of a half-cut
  // animation.
  const narrow = matchMedia('(max-width: 900px)').matches;
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

  if (reduce || narrow || !window.gsap || !window.ScrollTrigger) {
    // Reduced motion, a narrow (mobile/tablet) viewport, or the vendor
    // scripts didn't load: no pin, no scrub — the section behaves like any
    // other, with one still, part-way-exploded frame (the CSS fallback above
    // un-sticks it).
    section.classList.add('is-static');
    paint(0.5);
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
