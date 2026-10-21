// Printing: the week's menu as a clean sheet (one block per day) to hang on the
// fridge or save as a PDF. The page is not printed as it is on screen — a
// separate #print-sheet is built, shown only while the browser prints.

import { t as tr } from './i18n.js';
import { h, fmt, fmtDate, addDays, weekdayName } from './util.js';
import { state, today, targets, dayPlan } from './store.js';
import { FOOD_BY_ID, household } from './foods.js';
import { extraFood } from './extras.js';

// days: how many days from today (default a week).
export function buildPrintSheet(days = 7) {
  const sheet = h('div', { id: 'print-sheet' },
    h('h1', null, tr('My menu')),
    h('p', null, `${state.profile.nickname || state.profile.name} · ${fmtDate(today())} – ${fmtDate(addDays(today(), days - 1))}`));
  for (let i = 0; i < days; i++) {
    const day = addDays(today(), i);
    const t = targets(day);
    if (!t) continue;
    const meals = dayPlan(day);
    sheet.appendChild(h('section', { class: 'print-day' },
      h('h2', null, `${weekdayName(day)} ${fmtDate(day)} — ${tr('{0} kcal', fmt(t.calories))}`),
      ...meals.map((m) => h('div', { class: 'print-meal' },
        h('h3', null, `${m.name} · ${tr('{0} kcal', fmt(m.totals.kcal))}`),
        h('ul', null,
          ...(m.eaten ? [] : m.items.map((it) => {
            const food = FOOD_BY_ID[it.foodId];
            return h('li', null, `${food.name}: ${tr('{0} g', fmt(it.grams))} (${household(food, it.grams)})`);
          })),
          ...(m.eaten ? [] : (m.extras || []).map((e) => {
            const f = extraFood(e.foodId);
            return f ? h('li', null, `${f.name}: ${tr('{0} g', fmt(e.grams))}`) : null;
          })),
          ...(m.eaten ? [] : (m.custom || []).map((c) => h('li', null, `${c.name}: ${tr('{0} kcal', fmt(c.kcal))}`))))))));
  }
  return sheet;
}

export function printWeek(days = 7) {
  const sheet = buildPrintSheet(days);
  document.body.appendChild(sheet);
  document.body.classList.add('printing');
  const done = () => {
    document.body.classList.remove('printing');
    sheet.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  // Some browsers never fire afterprint (or print() returns at once): clean up on a timer too.
  window.print();
  setTimeout(done, 60000);
}

export function printPage() {
  window.print();
}
