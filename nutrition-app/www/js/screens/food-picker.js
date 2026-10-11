// "Foods I don't eat" picker: every food the user's diet allows, grouped by
// category, tap to exclude. A category can never drop below MIN_PER_ROLE, so
// every menu item keeps a substitute.

import { h, icon, sheet, toast, clear } from '../util.js';
import { FOODS, ROLE_LABEL, ROLES, MIN_PER_ROLE, isAllowed } from '../foods.js';

const ROLE_TITLE = { protein: 'חלבונים', carb: 'פחמימות', fat: 'שומנים', veg: 'ירקות', fruit: 'פירות' };

export function pickerLabel(ids) {
  const n = (ids || []).length;
  return n ? `בחירה מרשימת המאכלים (${n} הוצאו מהתפריט)` : 'בחירה מרשימת המאכלים';
}

// prefs: the current (possibly unsaved) preferences. onSave(excludedIds).
export function openFoodPicker(prefs, onSave) {
  const excluded = new Set(prefs.excluded || []);
  // Foods the diet / allergies / kosher / free-text already rule out are not listed.
  const base = { ...prefs, excluded: [] };
  const listed = FOODS.filter((f) => isAllowed(f, base));
  const remaining = (role) => listed.filter((f) => f.role === role && !excluded.has(f.id)).length;

  sheet('מאכלים שאני לא אוכל/ת', (close) => {
    const body = h('div', { class: 'picker' });
    const search = h('input', { type: 'search', placeholder: 'חיפוש מאכל…', 'aria-label': 'חיפוש מאכל', class: 'picker-search' });
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
            'aria-label': `${f.name}${off ? ' — לא אוכל/ת' : ''}`,
            onclick: () => {
              if (off) {
                excluded.delete(f.id);
              } else {
                if (remaining(role) - 1 < MIN_PER_ROLE) {
                  toast(`צריך להשאיר לפחות ${MIN_PER_ROLE} ${ROLE_TITLE[role]}, כדי שתמיד יהיה תחליף.`);
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
            h('span', { class: 'muted small' }, `${left} באפשרויות`)),
          chips));
      }
      if (!groups.childNodes.length) groups.appendChild(h('p', { class: 'empty' }, 'לא נמצא מאכל בשם הזה.'));
    };
    search.addEventListener('input', draw);
    draw();

    body.append(
      h('p', { class: 'muted small' }, `לחיצה על מאכל מוציאה אותו מהתפריט (מסומן באדום). כל ${ROLE_LABEL.protein}, פחמימה ושומן בתפריט תמיד יקבלו תחליף מהמאכלים שנשארו.`),
      search,
      groups,
      h('div', { class: 'picker-actions' },
        h('button', { type: 'button', class: 'btn btn-primary btn-block', id: 'picker-save', onclick: () => { onSave([...excluded]); close(); } },
          icon('check', 18), `שמירה (${excluded.size} מוחרגים)`)));
    return body;
  });
}
