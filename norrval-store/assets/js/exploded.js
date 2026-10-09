/* NORRVAL — exploded-view diagram, pinned in the homepage intro.
 *
 * `.intro-pin` freezes via plain CSS `position: sticky` (see main.css); this
 * script only turns "how far through that pin are we" into part positions.
 * See components/exploded-view.js for what each <g data-part> is and its own
 * --ax/--ay explode direction.
 *
 * Progress is read from the live layout on every frame instead of from
 * offsets cached at load. Cached offsets (what GSAP ScrollTrigger did here)
 * go stale whenever anything above the section changes height after load —
 * the Google Fonts swap reflowing the hero text on a real phone is enough —
 * and then the explosion started before the screen froze.
 */
(() => {
  'use strict';
  const section = document.querySelector('[data-xp-pin]');
  const el = document.querySelector('[data-xp-inline]');
  if (!section || !el) return;
  const sticky = section.querySelector('.intro-pin__sticky');

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const parts = [...el.querySelectorAll('[data-part]')];

  // Extra pull for parts that should travel further than their neighbours.
  const DIST = { crystal: 112, strapTop: 165, strapBottom: 130, crown: 100, caseback: 135 };
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

  if (reduce) {
    // No pin, no scrub — the section behaves like any other, with one still,
    // part-way-exploded frame (the CSS fallback un-sticks it).
    section.classList.add('is-static');
    paint(0.5);
    return;
  }

  // 0 the moment the sticky box pins (section top reaches the viewport top),
  // 1 the moment it un-pins (sticky box bottom meets the section bottom) —
  // exactly the span the screen is frozen for.
  function target() {
    const range = section.offsetHeight - sticky.offsetHeight;
    if (range <= 0) return 0;
    return Math.min(1, Math.max(0, -section.getBoundingClientRect().top / range));
  }

  let current = target();
  let raf = 0;
  function tick() {
    const t = target();
    current += (t - current) * 0.2; // same feel as the old `scrub: 0.4` lag
    if (Math.abs(t - current) < 0.001) current = t;
    paint(current);
    raf = current === t ? 0 : requestAnimationFrame(tick);
  }
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(tick);
  };
  paint(current);
  addEventListener('scroll', kick, { passive: true });
  addEventListener('resize', kick);
})();
