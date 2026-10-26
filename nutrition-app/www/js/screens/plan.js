// Plan: the menu for any day in the coming week, with per-item swaps and
// per-meal reshuffles.

import { t as tr } from '../i18n.js';
import { h, icon, fmt, addDays, weekdayName, fmtDate } from '../util.js';
import { mealRow } from '../components.js';
import { dayTotals } from '../mealplan.js';
import { today, targets, dayPlan } from '../store.js';
import { printWeek } from '../print.js';

let selected = null;

export function renderPlan(root) {
  const t0 = today();
  if (!selected || selected < t0 || selected > addDays(t0, 6)) selected = t0;
  const day = selected;
  const t = targets(day);
  const plan = dayPlan(day);
  const tot = dayTotals(plan);

  root.appendChild(h('header', { class: 'page-head' },
    h('div', null, h('h1', null, tr('My menu')), h('p', { class: 'muted' }, tr('Tailored to your goal, restrictions and number of meals')))));
  root.appendChild(h('a', { href: '#/shopping', class: 'btn btn-primary btn-block shop-btn', id: 'btn-shopping' }, h('span', { 'aria-hidden': 'true' }, '🛒'), tr('Weekly shopping')));

  root.appendChild(h('button', { type: 'button', class: 'btn btn-block btn-ghost no-print', id: 'btn-print-week', onclick: () => printWeek(7) }, icon('print', 18), tr('Print the week\'s menu')));

  const strip = h('div', { class: 'day-strip', role: 'tablist', 'aria-label': tr('Choose a day') });
  for (let i = 0; i < 7; i++) {
    const k = addDays(t0, i);
    strip.appendChild(h('button', {
      role: 'tab',
      'aria-selected': k === day ? 'true' : 'false',
      class: 'day' + (k === day ? ' on' : ''),
      onclick: () => { selected = k; window.dispatchEvent(new Event('app:rerender')); },
    }, h('small', null, i === 0 ? tr('Today') : weekdayName(k)), h('b', { class: 'num' }, fmtDate(k))));
  }
  root.appendChild(strip);

  root.appendChild(h('section', { class: 'card targets' },
    h('div', { class: 'target-grid' },
      h('div', null, h('small', null, tr('Calories')), h('b', { class: 'num' }, fmt(tot.kcal)), h('small', { class: 'muted num' }, tr('Target {0}', fmt(t.calories)))),
      h('div', { class: 'protein' }, h('small', null, tr('Protein')), h('b', { class: 'num' }, fmt(tot.p)), h('small', { class: 'muted num' }, tr('Target {0}', t.protein))),
      h('div', { class: 'carb' }, h('small', null, tr('Carbs‖checkin')), h('b', { class: 'num' }, fmt(tot.c)), h('small', { class: 'muted num' }, tr('Target {0}', t.carbs))),
      h('div', { class: 'fat' }, h('small', null, tr('Fat')), h('b', { class: 'num' }, fmt(tot.f)), h('small', { class: 'muted num' }, tr('Target {0}', t.fat))))));

  for (const m of plan) root.appendChild(mealRow(m, { day }));
  root.appendChild(h('p', { class: 'muted small center' }, tr('Amounts are by cooked / ready-to-eat weight. Vegetables can be eaten fairly freely.')));
}
