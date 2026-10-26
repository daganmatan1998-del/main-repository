// One meal on its own page (#/meal/<day>/<index>): everything about it — the foods and
// their swaps, sauces, your own foods, water, drinks, recipes, the calorie camera.
// Today and the menu show each meal as a single row that opens this page.

import { t as tr } from '../i18n.js';
import { h, icon, weekdayName, fmtDate, addDays } from '../util.js';
import { mealCard } from '../components.js';
import { state, today, dayPlan, targets, toggleEaten, setOverride } from '../store.js';

export function parseMealHash(hash = location.hash) {
  const m = String(hash).match(/^#\/meal\/(\d{4}-\d{2}-\d{2})\/(\d{1,2})/);
  return m ? { day: m[1], index: Number(m[2]) } : null;
}

export function renderMeal(root, { askAbout }) {
  const want = parseMealHash();
  const t0 = today();
  const meal = want && want.day >= addDays(t0, -7) && want.day <= addDays(t0, 6) && targets(want.day)
    ? dayPlan(want.day).find((m) => m.index === want.index) : null;
  if (!meal) { location.replace('#/today'); return; }
  const { day } = want;
  const eaten = new Set((state.logs[day] || { eaten: [] }).eaten);

  root.appendChild(h('header', { class: 'page-head' },
    h('div', { class: 'row gap' },
      h('a', { href: day === t0 ? '#/today' : '#/plan', class: 'icon-btn', id: 'back-meals', 'aria-label': day === t0 ? tr('Back to Today') : tr('Back to the menu') }, icon('back')),
      h('div', null,
        h('h1', null, day === t0 ? tr('Today') : weekdayName(day)),
        h('p', { class: 'muted' }, fmtDate(day))))));

  const card = mealCard(meal, { day, eaten: eaten.has(meal.index), onToggle: day <= t0 ? () => toggleEaten(day, meal.index) : null, onAsk: askAbout });
  const ov = (state.overrides[day] || {})[meal.index] || {};
  card.appendChild(h('button', {
    class: 'btn btn-ghost btn-small reshuffle', id: 'btn-reshuffle',
    onclick: () => setOverride(day, meal.index, { reseed: (ov.reseed || 0) + 1 }),
  }, icon('shuffle', 16), tr('Another meal')));
  root.appendChild(card);
}
