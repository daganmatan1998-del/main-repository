// Plan: the menu for any day in the coming week, with per-item swaps and
// per-meal reshuffles.

import { h, icon, fmt, addDays, weekdayName, fmtDate } from '../util.js';
import { mealCard } from '../components.js';
import { dayTotals } from '../mealplan.js';
import { state, today, targets, dayPlan, setOverride } from '../store.js';

let selected = null;

export function renderPlan(root, { askAbout }) {
  const t0 = today();
  if (!selected || selected < t0 || selected > addDays(t0, 6)) selected = t0;
  const day = selected;
  const t = targets(day);
  const plan = dayPlan(day);
  const tot = dayTotals(plan);

  root.appendChild(h('header', { class: 'page-head' },
    h('div', null, h('h1', null, 'התפריט שלי'), h('p', { class: 'muted' }, 'מותאם ליעד, להגבלות ולמספר הארוחות שלך'))));
  root.appendChild(h('a', { href: '#/shopping', class: 'btn btn-primary btn-block shop-btn', id: 'btn-shopping' }, h('span', { 'aria-hidden': 'true' }, '🛒'), 'קניות לשבוע'));

  const strip = h('div', { class: 'day-strip', role: 'tablist', 'aria-label': 'בחירת יום' });
  for (let i = 0; i < 7; i++) {
    const k = addDays(t0, i);
    strip.appendChild(h('button', {
      role: 'tab',
      'aria-selected': k === day ? 'true' : 'false',
      class: 'day' + (k === day ? ' on' : ''),
      onclick: () => { selected = k; window.dispatchEvent(new Event('app:rerender')); },
    }, h('small', null, i === 0 ? 'היום' : weekdayName(k)), h('b', { class: 'num' }, fmtDate(k))));
  }
  root.appendChild(strip);

  root.appendChild(h('section', { class: 'card targets' },
    h('div', { class: 'target-grid' },
      h('div', null, h('small', null, 'קלוריות'), h('b', { class: 'num' }, fmt(tot.kcal)), h('small', { class: 'muted num' }, `יעד ${fmt(t.calories)}`)),
      h('div', { class: 'protein' }, h('small', null, 'חלבון'), h('b', { class: 'num' }, fmt(tot.p)), h('small', { class: 'muted num' }, `יעד ${t.protein}`)),
      h('div', { class: 'carb' }, h('small', null, 'פחמימה'), h('b', { class: 'num' }, fmt(tot.c)), h('small', { class: 'muted num' }, `יעד ${t.carbs}`)),
      h('div', { class: 'fat' }, h('small', null, 'שומן'), h('b', { class: 'num' }, fmt(tot.f)), h('small', { class: 'muted num' }, `יעד ${t.fat}`)))));

  for (const m of plan) {
    const card = mealCard(m, { day, onAsk: askAbout });
    const ov = (state.overrides[day] || {})[m.index] || {};
    card.appendChild(h('button', {
      class: 'btn btn-ghost btn-small reshuffle',
      onclick: () => setOverride(day, m.index, { reseed: (ov.reseed || 0) + 1 }),
    }, icon('shuffle', 16), 'ארוחה אחרת'));
    root.appendChild(card);
  }
  root.appendChild(h('p', { class: 'muted small center' }, 'הכמויות במשקל מבושל/מוכן לאכילה. ירקות בכמות חופשית יחסית.'));
}
