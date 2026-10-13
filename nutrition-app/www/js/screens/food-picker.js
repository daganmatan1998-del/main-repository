// "Foods I don't eat" picker: every food the user's diet allows, grouped by
// category, tap to exclude. A category can never drop below MIN_PER_ROLE, so
// every menu item keeps a substitute.

import { t as tr, lc } from '../i18n.js';
import { h, icon, sheet, toast, clear } from '../util.js';
import { FOODS, ROLE_LABEL, ROLES, MIN_PER_ROLE, isAllowed } from '../foods.js';

const ROLE_TITLE = { protein: tr('Proteins'), carb: tr('Carbs'), fat: tr('Fats'), veg: tr('Vegetables'), fruit: tr('Fruits') };

export function pickerLabel(ids) {
  const n = (ids || []).length;
  return n ? tr('Choose from the food list ({0} taken out of the menu)', n) : tr('Choose from the food list');
}

// prefs: the current (possibly unsaved) preferences. onSave(excludedIds).
export function openFoodPicker(prefs, onSave) {
  const excluded = new Set(prefs.excluded || []);
  // Foods the diet / allergies / kosher / free-text already rule out are not listed.
  const base = { ...prefs, excluded: [] };
  const listed = FOODS.filter((f) => isAllowed(f, base));
  const remaining = (role) => listed.filter((f) => f.role === role && !excluded.has(f.id)).length;

  sheet(tr('Foods I don\'t eat'), (close) => {
    const body = h('div', { class: 'picker' });
    const search = h('input', { type: 'search', placeholder: tr('Search foods…'), 'aria-label': tr('Search foods'), class: 'picker-search' });
    const groups = h('div');

    const draw = () => {
      clear(groups);
      const q = search.value.trim();
      for (const role of ROLES) {
        const foods = listed.filter((f) => f.role === role && (!q || f.name.includes(q) || (f.aliases || []).some((a) => a.includes(q))));
        if (!foods.length) continue;
        const left = remaining(role);
        const chips = h('div', { class: 'chips' });
        for (const f of foods) {
          const off = excluded.has(f.id);
          chips.appendChild(h('button', {
            type: 'button',
            class: 'chip food-chip' + (off ? ' off' : ''),
            'aria-pressed': off ? 'true' : 'false',
            'aria-label': `${f.name}${off ? tr(' — don\'t eat') : ''}`,
            onclick: () => {
              if (off) {
                excluded.delete(f.id);
              } else {
                if (remaining(role) - 1 < MIN_PER_ROLE) {
                  toast(tr('At least {0} {1} must stay so there is always a substitute.', MIN_PER_ROLE, lc(ROLE_TITLE[role])));
                  return;
                }
                excluded.add(f.id);
              }
              draw();
            },
          }, off ? icon('close', 14) : null, f.name));
        }
        groups.appendChild(h('section', { class: 'picker-group' },
          h('div', { class: 'row space' },
            h('h3', null, ROLE_TITLE[role]),
            h('span', { class: 'muted small' }, tr('{0} left', left))),
          chips));
      }
      if (!groups.childNodes.length) groups.appendChild(h('p', { class: 'empty' }, tr('No food with this name was found.')));
    };
    search.addEventListener('input', draw);
    draw();

    body.append(
      h('p', { class: 'muted small' }, tr('Tap a food to take it out of the menu (marked in red). Every {0}, carb and fat on your menu always gets a substitute from the remaining foods.', lc(ROLE_LABEL.protein))),
      search,
      groups,
      h('div', { class: 'picker-actions' },
        h('button', { type: 'button', class: 'btn btn-primary btn-block', id: 'picker-save', onclick: () => { onSave([...excluded]); close(); } },
          icon('check', 18), tr('Save ({0} excluded)', excluded.size))));
    return body;
  });
}
