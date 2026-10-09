// Recipes for one meal: ready-made, built from the meal's own ingredients and
// amounts (or their substitutes), with filters for what's at home and what
// the user likes. Opens as a full-screen overlay from any meal card.

import { h, icon, clear, toast } from '../util.js';
import { state, saveSettings, setOverride } from '../store.js';
import { recipesForMeal, filterRecipes, CUISINES, TOOLS, PANTRY } from '../recipes.js';
import { FOOD_BY_ID } from '../foods.js';

const PAGE = 12;
const DEFAULT_FILTERS = { cuisines: [], tools: [], maxTime: 0, pantryOnly: false, have: [], noSpicy: false, noSwaps: false, favorites: false };
const TOOL_LABEL = Object.fromEntries(TOOLS.map((t) => [t.id, t.label]));

function filters() {
  return { ...DEFAULT_FILTERS, ...(state.settings.recipeFilters || {}) };
}

function activeCount(f) {
  return f.cuisines.length + f.tools.length + (f.maxTime ? 1 : 0) + (f.pantryOnly ? 1 : 0) + (f.noSpicy ? 1 : 0) + (f.noSwaps ? 1 : 0) + (f.favorites ? 1 : 0);
}

function chipGroup(options, selected, onToggle) {
  return h('div', { class: 'chips' }, ...options.map((o) => {
    const on = selected.includes(o.id);
    return h('button', {
      type: 'button',
      class: 'chip' + (on ? ' on' : ''),
      'aria-pressed': on ? 'true' : 'false',
      onclick: () => onToggle(o.id),
    }, o.label);
  }));
}

function toggleRow(label, checked, onChange, id) {
  return h('label', { class: 'switch-row' }, h('span', null, label),
    h('input', { type: 'checkbox', role: 'switch', checked, id, onchange: (e) => onChange(e.target.checked) }));
}

export function openRecipes(meal, day) {
  const prefs = state.profile.prefs;
  const all = recipesForMeal(meal, prefs, { day });
  let f = filters();
  let shown = PAGE;
  let panelOpen = false;
  let q = '';

  const el = h('div', { class: 'overlay recipes', role: 'dialog', 'aria-modal': 'true', 'aria-label': `מתכונים ל${meal.name}` });
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey); window.removeEventListener('hashchange', close); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', close);

  const save = (patch) => {
    f = { ...f, ...patch };
    shown = PAGE;
    saveSettings({ recipeFilters: f });
    draw();
  };
  const favIds = () => (state.settings.favRecipes || []).map((x) => x.id);

  const body = h('div', { class: 'rc-body' });
  el.appendChild(body);

  const search = h('input', { type: 'search', id: 'rc-search', placeholder: 'חיפוש: שם, מרכיב או תבלין…', 'aria-label': 'חיפוש מתכון' });
  search.addEventListener('input', () => { q = search.value; shown = PAGE; drawList(); });
  const listBox = h('div');
  const panelBox = h('div');
  const filterBtn = h('button', { class: 'btn btn-small', id: 'rc-filter-btn', 'aria-expanded': 'false', onclick: () => { panelOpen = !panelOpen; draw(); } });

  function drawPanel() {
    clear(panelBox);
    filterBtn.setAttribute('aria-expanded', panelOpen ? 'true' : 'false');
    clear(filterBtn).append(icon('edit', 16), ` סינון${activeCount(f) ? ` (${activeCount(f)})` : ''}`);
    if (!panelOpen) return;
    const toggleIn = (key) => (id) => save({ [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id] });
    panelBox.appendChild(h('section', { class: 'card rc-panel', id: 'rc-panel' },
      h('h3', null, 'מה יש לי בבית?'),
      h('p', { class: 'muted small' }, 'סמנו תבלינים ובסיסים שיש לכם. מלח, פלפל ומים — תמיד בחשבון.'),
      chipGroup(PANTRY.map((p) => ({ id: p, label: p })), f.have, toggleIn('have')),
      h('div', { class: 'row gap wrap rc-mini' },
        h('button', { type: 'button', class: 'btn btn-small btn-ghost', onclick: () => save({ have: PANTRY.slice() }) }, 'סמן הכול'),
        h('button', { type: 'button', class: 'btn btn-small btn-ghost', onclick: () => save({ have: [] }) }, 'נקה')),
      toggleRow('להציג רק מתכונים שיש לי את כל התבלינים שלהם', f.pantryOnly, (v) => save({ pantryOnly: v }), 'rc-pantry-only'),
      h('h3', null, 'סגנון שאני אוהב/ת'),
      chipGroup(CUISINES, f.cuisines, toggleIn('cuisines')),
      h('h3', null, 'במה לבשל'),
      chipGroup(TOOLS, f.tools, toggleIn('tools')),
      h('h3', null, 'זמן הכנה'),
      h('div', { class: 'segmented small', role: 'radiogroup', 'aria-label': 'זמן הכנה' },
        ...[[0, 'הכול'], [10, 'עד 10 דק׳'], [20, 'עד 20 דק׳'], [40, 'עד 40 דק׳']].map(([v, label]) => h('button', {
          type: 'button', role: 'radio', 'aria-checked': f.maxTime === v ? 'true' : 'false', class: f.maxTime === v ? 'on' : '',
          onclick: () => save({ maxTime: v }),
        }, label))),
      toggleRow('בלי חריף', f.noSpicy, (v) => save({ noSpicy: v }), 'rc-no-spicy'),
      toggleRow('רק עם המרכיבים שבתפריט (בלי תחליפים)', f.noSwaps, (v) => save({ noSwaps: v }), 'rc-no-swaps'),
      toggleRow('רק המועדפים שלי ❤', f.favorites, (v) => save({ favorites: v }), 'rc-favs'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-block', onclick: () => save({ ...DEFAULT_FILTERS }) }, 'איפוס כל הסינונים')));
  }

  function recipeCard(r) {
    const fav = favIds().includes(r.id);
    const details = h('div', { class: 'rc-details', hidden: true });
    const head = h('button', { class: 'rc-head', 'aria-expanded': 'false' },
      h('span', { class: 'rc-title' }, r.title),
      h('span', { class: 'rc-meta muted small' },
        `⏱ ${r.time} דק׳ · ${TOOL_LABEL[r.tool]} · ${r.flavorLabel}${r.spicy ? ' · 🌶' : ''}`),
      r.swaps.length ? h('span', { class: 'rc-swap small' }, `עם תחליף: ${r.swaps.map((s) => FOOD_BY_ID[s.foodId].name).join(', ')}`) : null);
    head.addEventListener('click', () => {
      const open = details.hidden;
      details.hidden = !open;
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      card.classList.toggle('open', open);
    });
    const favBtn = h('button', {
      class: 'btn btn-small' + (fav ? ' btn-primary' : ''),
      'aria-pressed': fav ? 'true' : 'false',
      onclick: async () => {
        const list = state.settings.favRecipes || [];
        const has = list.some((x) => x.id === r.id);
        await saveSettings({ favRecipes: has ? list.filter((x) => x.id !== r.id) : [...list, { id: r.id, title: r.title }].slice(-300) });
        favBtn.classList.toggle('btn-primary', !has);
        favBtn.setAttribute('aria-pressed', !has ? 'true' : 'false');
        favBtn.lastChild.textContent = !has ? ' שמור' : ' שמירה';
        toast(!has ? 'נשמר למועדפים' : 'הוסר מהמועדפים');
      },
    }, '❤', fav ? ' שמור' : ' שמירה');
    details.append(
      h('h4', null, 'מצרכים'),
      h('ul', { class: 'rc-ingr' }, ...r.ingredients.map((i) => h('li', null, h('b', { class: 'num' }, `${i.grams} ג׳`), ` ${i.name} `, h('span', { class: 'muted' }, `(${i.household})`)))),
      h('p', { class: 'small muted' }, `תבלינים ובסיס: ${r.pantry.join(', ')}, מלח ופלפל. בכמויות קטנות — בלי קלוריות משמעותיות.`),
      h('h4', null, 'אופן ההכנה'),
      h('ol', { class: 'rc-steps' }, ...r.steps.map((s) => h('li', null, s))),
      h('div', { class: 'row gap wrap' },
        favBtn,
        r.swaps.length ? h('button', {
          class: 'btn btn-small btn-primary',
          onclick: async () => {
            for (const s of r.swaps) await setOverride(day, meal.index, { swap: s });
            toast('התפריט עודכן לפי המתכון');
            close();
          },
        }, icon('swap', 16), 'להחליף בתפריט לפי המתכון') : null));
    const card = h('article', { class: 'card rc-card' }, head, details);
    return card;
  }

  function drawList() {
    clear(listBox);
    const list = filterRecipes(all, { ...f, q, favIds: favIds() });
    listBox.appendChild(h('p', { class: 'muted small', id: 'rc-count', 'aria-live': 'polite' },
      `נמצאו ${list.length.toLocaleString('he-IL')} מתכונים לארוחה הזו`));
    if (!list.length) {
      listBox.appendChild(h('div', { class: 'empty' },
        h('p', null, 'אין מתכונים שמתאימים לכל הסינונים.'),
        h('button', { class: 'btn btn-small', onclick: () => save({ ...DEFAULT_FILTERS }) }, 'איפוס סינונים')));
    }
    list.slice(0, shown).forEach((r) => listBox.appendChild(recipeCard(r)));
    if (list.length > shown) {
      listBox.appendChild(h('button', { class: 'btn btn-block', id: 'rc-more', onclick: () => { shown += PAGE; drawList(); } },
        `עוד מתכונים (${(list.length - shown).toLocaleString('he-IL')} נוספים)`));
    }
  }

  function draw() {
    drawPanel();
    drawList();
  }

  const askAI = () => {
    const items = meal.items.map((i) => `${i.grams} ג׳ ${FOOD_BY_ID[i.foodId].name}`).join(', ');
    const likes = f.cuisines.map((c) => CUISINES.find((x) => x.id === c)?.label).filter(Boolean);
    const text = `תן לי מתכון חדש ל${meal.name} עם המרכיבים: ${items}.${likes.length ? ` אני אוהב/ת סגנון ${likes.join(' או ')}.` : ''}${f.pantryOnly && f.have.length ? ` יש לי בבית: ${f.have.join(', ')}.` : ''}`;
    close();
    window.dispatchEvent(new CustomEvent('app:ask', { detail: { text, extra: { recipeRequest: { meal: meal.name, items: meal.items.map((i) => ({ name: FOOD_BY_ID[i.foodId].name, grams: i.grams })) } } } }));
  };

  body.append(
    h('div', { class: 'rc-top' },
      h('div', { class: 'bf-head' },
        h('h2', null, `מתכונים ל${meal.name}`),
        h('button', { class: 'icon-btn', 'aria-label': 'סגירה', onclick: close }, icon('close', 24))),
      h('p', { class: 'muted small' }, 'כל מתכון בנוי בדיוק מהכמויות של הארוחה, כך שהתפריט נשאר מאוזן.'),
      h('div', { class: 'chips rc-items' }, ...meal.items.map((i) => h('span', { class: 'pill' }, `${FOOD_BY_ID[i.foodId].name} ${i.grams} ג׳`))),
      h('div', { class: 'row gap rc-search-row' }, search, filterBtn)),
    panelBox,
    listBox,
    h('button', { class: 'btn btn-ghost btn-block', id: 'rc-ai', onclick: askAI }, icon('sparkle', 18), 'רעיון חדש לגמרי מהעוזר'));

  document.body.appendChild(el);
  draw();
  return { close };
}
