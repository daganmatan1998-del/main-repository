// Weekly shopping list screen. A menu week matches a check-in week, so the
// list covers either the rest of this week or the whole of next week.

import { t as tr } from '../i18n.js';
import { h, icon, fmtDate, addDays, daysBetween, toast } from '../util.js';
import { state, today, targets, dayPlan, menuWeek, menuWeekRange, saveShoppingChecks } from '../store.js';
import { buildShoppingList, shoppingText } from '../shopping.js';

let choice = null; // 'this' | 'next'

function range(which) {
  const t = today();
  const week = menuWeek(t) + (which === 'next' ? 1 : 0);
  const { start, end } = menuWeekRange(week);
  const from = which === 'next' ? start : t;
  return { from, to: end, days: daysBetween(from, end) + 1, key: `${week}` };
}

export function renderShopping(root) {
  if (!choice) choice = daysBetween(today(), range('this').to) + 1 >= 3 ? 'this' : 'next';
  const r = range(choice);
  const days = [];
  for (let i = 0; i < r.days; i++) {
    const day = addDays(r.from, i);
    if (targets(day)) days.push({ day, meals: dayPlan(day) });
  }
  const groups = buildShoppingList(days);
  const checked = new Set((state.shopping || {})[r.key] || []);
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  root.appendChild(h('header', { class: 'page-head' },
    h('div', { class: 'row gap' },
      h('a', { href: '#/plan', class: 'icon-btn', 'aria-label': tr('Back to the menu') }, icon('back')),
      h('div', null,
        h('h1', null, tr('Weekly shopping')),
        h('p', { class: 'muted' }, tr('{0} to {1} · {2} days · {3} items', fmtDate(r.from), fmtDate(r.to), r.days, total))))));

  const thisR = range('this');
  const nextR = range('next');
  const seg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': tr('Which week') },
    ...[['this', tr('This week (until {0})', fmtDate(thisR.to))], ['next', tr('Next week ({0} to {1})', fmtDate(nextR.from), fmtDate(nextR.to))]].map(([id, label]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': choice === id ? 'true' : 'false', class: choice === id ? 'on' : '',
      onclick: () => { choice = id; window.dispatchEvent(new Event('app:rerender')); },
    }, label)));
  root.appendChild(seg);

  const progress = h('p', { class: 'muted small center', id: 'shop-progress' });
  const updateProgress = () => {
    progress.textContent = tr('{0} of {1} checked', checked.size, total);
  };

  const list = h('div', { class: 'shop-list' });
  for (const g of groups) {
    const ul = h('ul', { class: 'shop-items' });
    for (const it of g.items) {
      const on = checked.has(it.id);
      const li = h('li', { 'data-item': it.id },
        h('label', { class: 'shop-item' + (on ? ' done' : '') },
          h('input', {
            type: 'checkbox', checked: on,
            onchange: async (e) => {
              if (e.target.checked) checked.add(it.id); else checked.delete(it.id);
              e.target.closest('.shop-item').classList.toggle('done', e.target.checked);
              updateProgress();
              await saveShoppingChecks(r.key, [...checked]);
            },
          }),
          h('span', { class: 'shop-text' },
            h('span', { class: 'shop-name' }, it.name),
            h('span', { class: 'shop-qty' }, it.qty, it.detail ? h('small', { class: 'muted' }, ` · ${it.detail}`) : null),
            it.note ? h('small', { class: 'muted shop-note' }, it.note) : null)));
      ul.appendChild(li);
    }
    list.appendChild(h('section', { class: 'card shop-group' },
      h('h2', null, h('span', { 'aria-hidden': 'true' }, `${g.icon} `), g.label),
      ul));
  }
  if (!groups.length) list.appendChild(h('p', { class: 'empty' }, tr('There are no days in this range.')));

  const share = async () => {
    const text = shoppingText(groups, tr('🛒 Shopping {0} to {1}', fmtDate(r.from), fmtDate(r.to)));
    try {
      if (navigator.share) { await navigator.share({ title: tr('Shopping list'), text }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try {
      await navigator.clipboard.writeText(text);
      toast(tr('The list was copied — you can paste it into a chat'));
    } catch {
      toast(tr('Sharing isn\'t available in this browser'));
    }
  };

  root.append(
    h('div', { class: 'row gap shop-actions' },
      h('button', { class: 'btn btn-primary grow', id: 'shop-share', onclick: share }, icon('send', 18), tr('Share / copy')),
      h('button', {
        class: 'btn', onclick: async () => {
          checked.clear();
          await saveShoppingChecks(r.key, []);
          window.dispatchEvent(new Event('app:rerender'));
        },
      }, tr('Uncheck all'))),
    progress,
    list,
    h('p', { class: 'muted small center' }, tr('The amounts are calculated from all of the meals in the range, including the swaps you chose. Meat and grains are listed by raw weight. Adding a swap or changing the menu updates the list.')));
  updateProgress();
}
