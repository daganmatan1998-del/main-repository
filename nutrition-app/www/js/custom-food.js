// "Add your own food" under a meal: pick a common food (sausage, fries, Bamba…)
// or type what was eaten with its calories. The calories either come off the
// rest of the meal (the meal keeps its budget) or are added on top of it.
// Entries live in the meal's overrides (store.setOverride { custom }); the
// meal planner (mealplan.js) turns them into meal.custom.

import { t as tr } from './i18n.js';
import { h, icon, sheet, toast, fmt, parseNum, clear, normText } from './util.js';
import { state, setOverride } from './store.js';
import { everydayOptions, EVERYDAY_BY_ID, makeCustom, withServings, MAX_CUSTOM } from './everyday.js';
import { household, FOOD_BY_ID } from './foods.js';

const MODE_KEY = 'nutri-custom-mode';
let mode = 'offset';
try { if (localStorage.getItem(MODE_KEY) === 'add') mode = 'add'; } catch { /* storage unavailable */ }
const setMode = (m) => { mode = m; try { localStorage.setItem(MODE_KEY, m); } catch { /* storage unavailable */ } };

const stored = (day, meal) => ((state.overrides[day] || {})[meal.index] || {}).custom || [];

// The list under a meal: what was added, with its amount and calories.
export function customBlock(meal, day) {
  const wrap = h('div', { class: 'custom-foods' });
  const cur = stored(day, meal);
  const shown = meal.custom || [];
  if (shown.length) {
    const ul = h('ul', { class: 'extras-list' });
    shown.forEach((e, at) => {
      const food = e.ref && EVERYDAY_BY_ID[e.ref];
      const save = (next) => setOverride(day, meal.index, { custom: next });
      const step = food ? food.units[0].step || 1 : 1;
      const less = () => {
        const s = (cur[at].servings || 1) - step;
        save(s > 0 ? cur.map((x, i) => (i === at ? withServings(x, s) : x)) : cur.filter((_, i) => i !== at));
      };
      const more = () => save(cur.map((x, i) => (i === at ? withServings(x, (x.servings || 1) + step) : x)));
      ul.appendChild(h('li', { class: 'extra custom-row' },
        h('div', { class: 'extra-text' },
          h('div', { class: 'item-name' }, e.name),
          h('div', { class: 'item-amt' },
            food ? h('span', null, household(food, e.servings * food.units[0].g)) : null,
            h('span', { class: 'muted num' }, food ? tr(' · {0} kcal', e.kcal) : tr('{0} kcal', e.kcal)))),
        h('div', { class: 'extra-ctl' },
          food ? h('button', { type: 'button', class: 'icon-btn extra-minus', 'aria-label': tr('Less'), onclick: less }, icon('minus', 16)) : null,
          food ? h('button', { type: 'button', class: 'icon-btn extra-plus', 'aria-label': tr('More'), onclick: more }, icon('plus', 16)) : null,
          h('button', { type: 'button', class: 'icon-btn extra-del', 'aria-label': tr('Remove {0}', e.name), onclick: () => save(cur.filter((_, i) => i !== at)) }, icon('close', 16)))));
    });
    wrap.appendChild(ul);
    const off = shown.filter((e) => e.mode !== 'add').reduce((s, e) => s + e.kcal, 0);
    const on = shown.filter((e) => e.mode === 'add').reduce((s, e) => s + e.kcal, 0);
    if (off) wrap.appendChild(h('p', { class: 'extras-note small' }, icon('info', 16), h('span', null, tr('{0} kcal from your own foods were taken off the rest of the meal, so the meal keeps the same calories.', fmt(off)))));
    if (on) wrap.appendChild(h('p', { class: 'extras-note small' }, icon('info', 16), h('span', null, tr('{0} kcal from your own foods were added to the meal.', fmt(on)))));
  }
  wrap.appendChild(h('button', {
    type: 'button', class: 'btn btn-block btn-ghost custom-add',
    onclick: () => (cur.length >= MAX_CUSTOM ? toast(tr('You can add up to {0} of your own foods to a meal', MAX_CUSTOM)) : openCustomSheet(meal, day)),
  }, icon('plus', 18), tr('Add your own food')));
  return wrap;
}

// item: the plan item being replaced (from the swap sheet), if any.
export function openCustomSheet(meal, day, { item = null } = {}) {
  const food = item && FOOD_BY_ID[item.foodId];
  return sheet(tr('Add your own food'), (close) => {
    const commit = async (entry) => {
      entry.mode = mode;
      if (item) entry.slot = item.slot;
      const cur = stored(day, meal).filter((x) => !(item && x.slot === item.slot));
      const made = makeCustom(entry);
      await setOverride(day, meal.index, { custom: [...cur, made].slice(0, MAX_CUSTOM) });
      close();
      toast(made.mode === 'add'
        ? tr('{0} added — {1} kcal added to the meal', made.name, made.kcal)
        : tr('{0} added — {1} kcal taken off the rest of the meal', made.name, made.kcal));
    };

    // How the calories count: off the rest of the meal, or on top.
    const note = h('p', { class: 'muted small custom-mode-note' });
    const opts = [['offset', tr('Take off the rest of the meal')], ['add', tr('Add on top')]];
    const seg = h('div', { class: 'custom-mode', role: 'radiogroup', 'aria-label': tr('How the calories count') });
    const drawMode = () => {
      clear(seg);
      for (const [m, label] of opts) {
        seg.appendChild(h('button', {
          type: 'button', role: 'radio', 'aria-checked': mode === m ? 'true' : 'false', 'data-mode': m,
          class: 'custom-mode-btn' + (mode === m ? ' on' : ''),
          onclick: () => { setMode(m); drawMode(); },
        }, label));
      }
      note.textContent = mode === 'offset'
        ? tr('The rest of the meal gets smaller, so the meal keeps its calories.')
        : tr('The calories are added to the meal, so it goes over its budget.');
    };
    drawMode();

    // Common foods.
    const search = h('input', { class: 'search', id: 'custom-search', type: 'search', placeholder: tr('Search: fries, sausage, Bamba, pizza…'), autocomplete: 'off', 'aria-label': tr('Search') });
    const list = h('div', { class: 'extra-opts custom-opts' });
    const options = everydayOptions(state.profile.prefs);
    const draw = () => {
      clear(list);
      const q = normText(search.value);
      const hit = options.filter((o) => !q || normText(`${o.food.name} ${o.food.aliases.join(' ')}`).includes(q));
      if (!hit.length) { list.appendChild(h('p', { class: 'empty' }, tr('Nothing found. Try another word.'))); return; }
      for (const o of hit) {
        list.appendChild(h('div', { class: 'alt extra-opt', 'data-food': o.food.id },
          h('div', { class: 'alt-text' },
            h('div', { class: 'alt-name' }, o.food.name),
            h('div', { class: 'muted small num' }, tr('{0} · {1} kcal', o.amount, o.kcal))),
          h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: () => commit({ name: o.food.name, ref: o.food.id, servings: o.food.def }) }, tr('Add'))));
      }
    };
    search.addEventListener('input', draw);
    draw();

    // Typed by hand.
    const name = h('input', { class: 'custom-name', type: 'text', maxlength: 40, autocomplete: 'off', placeholder: tr('What did you eat?'), 'aria-label': tr('What did you eat') });
    const kcal = h('input', { class: 'custom-kcal', type: 'text', inputmode: 'numeric', placeholder: '0', 'aria-label': tr('Calories') });
    const mac = (cls, label) => h('input', { class: cls, type: 'text', inputmode: 'decimal', placeholder: '0', 'aria-label': label });
    const pIn = mac('custom-p', tr('Protein'));
    const cIn = mac('custom-c', tr('Carbs'));
    const fIn = mac('custom-f', tr('Fat'));
    const addTyped = () => {
      const k = parseNum(kcal.value);
      if (!name.value.trim() || !(k > 0)) { toast(tr('Write what you ate and how many calories')); (name.value.trim() ? kcal : name).focus(); return; }
      commit({ name: name.value, kcal: k, p: parseNum(pIn.value) || 0, c: parseNum(cIn.value) || 0, f: parseNum(fIn.value) || 0 });
    };
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); kcal.focus(); } });
    kcal.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } });
    const form = h('div', { class: 'custom-form' },
      h('h4', { class: 'extra-group' }, tr('Not on the list? Type it yourself')),
      name,
      h('div', { class: 'custom-nums' },
        h('label', null, h('span', null, tr('Calories')), kcal),
        h('label', null, h('span', null, tr('Protein (g)')), pIn),
        h('label', null, h('span', null, tr('Carbs (g)')), cIn),
        h('label', null, h('span', null, tr('Fat (g)')), fIn)),
      h('p', { class: 'muted small' }, tr('The grams are optional. Calories are enough.')),
      h('button', { type: 'button', class: 'btn btn-primary btn-block custom-typed-add', onclick: addTyped }, icon('plus', 16), tr('Add')));

    return h('div', null,
      food ? h('p', { class: 'small custom-instead' }, tr('Instead of {0}', food.name)) : null,
      seg, note,
      search, list,
      form);
  });
}
