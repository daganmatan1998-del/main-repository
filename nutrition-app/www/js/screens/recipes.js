// Recipes for one meal: ready-made, built from the meal's own ingredients and
// amounts (or their substitutes), with filters for what's at home and what
// the user likes. Opens as a full-screen overlay from any meal card.

import { t as tr } from '../i18n.js';
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

  const el = h('div', { class: 'overlay recipes', role: 'dialog', 'aria-modal': 'true', 'aria-label': tr('Recipes for {0}', meal.name) });
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

  const search = h('input', { type: 'search', id: 'rc-search', placeholder: tr('Search: name, ingredient or spice…'), 'aria-label': tr('Search recipes') });
  search.addEventListener('input', () => { q = search.value; shown = PAGE; drawList(); });
  const listBox = h('div');
  const panelBox = h('div');
  const filterBtn = h('button', { class: 'btn btn-small', id: 'rc-filter-btn', 'aria-expanded': 'false', onclick: () => { panelOpen = !panelOpen; draw(); } });

  function drawPanel() {
    clear(panelBox);
    filterBtn.setAttribute('aria-expanded', panelOpen ? 'true' : 'false');
    clear(filterBtn).append(icon('edit', 16), tr(' Filter{0}', activeCount(f) ? ` (${activeCount(f)})` : ''));
    if (!panelOpen) return;
    const toggleIn = (key) => (id) => save({ [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id] });
    panelBox.appendChild(h('section', { class: 'card rc-panel', id: 'rc-panel' },
      h('h3', null, tr('What do I have at home?')),
      h('p', { class: 'muted small' }, tr('Check the spices and staples you have. Salt, pepper and water are always included.')),
      chipGroup(PANTRY.map((p) => ({ id: p, label: p })), f.have, toggleIn('have')),
      h('div', { class: 'row gap wrap rc-mini' },
        h('button', { type: 'button', class: 'btn btn-small btn-ghost', onclick: () => save({ have: PANTRY.slice() }) }, tr('Select all')),
        h('button', { type: 'button', class: 'btn btn-small btn-ghost', onclick: () => save({ have: [] }) }, tr('Clear'))),
      toggleRow(tr('Show only recipes I have all the spices for'), f.pantryOnly, (v) => save({ pantryOnly: v }), 'rc-pantry-only'),
      h('h3', null, tr('Styles I like')),
      chipGroup(CUISINES, f.cuisines, toggleIn('cuisines')),
      h('h3', null, tr('Cooking with')),
      chipGroup(TOOLS, f.tools, toggleIn('tools')),
      h('h3', null, tr('Prep time')),
      h('div', { class: 'segmented small', role: 'radiogroup', 'aria-label': tr('Prep time') },
        ...[[0, tr('Any')], [10, tr('Up to 10 min')], [20, tr('Up to 20 min')], [40, tr('Up to 40 min')]].map(([v, label]) => h('button', {
          type: 'button', role: 'radio', 'aria-checked': f.maxTime === v ? 'true' : 'false', class: f.maxTime === v ? 'on' : '',
          onclick: () => save({ maxTime: v }),
        }, label))),
      toggleRow(tr('Not spicy'), f.noSpicy, (v) => save({ noSpicy: v }), 'rc-no-spicy'),
      toggleRow(tr('Only with ingredients on my menu (no substitutes)'), f.noSwaps, (v) => save({ noSwaps: v }), 'rc-no-swaps'),
      toggleRow(tr('Only my favorites ❤'), f.favorites, (v) => save({ favorites: v }), 'rc-favs'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-block', onclick: () => save({ ...DEFAULT_FILTERS }) }, tr('Reset all filters'))));
  }

  function recipeCard(r) {
    const fav = favIds().includes(r.id);
    const details = h('div', { class: 'rc-details', hidden: true });
    const head = h('button', { class: 'rc-head', 'aria-expanded': 'false' },
      h('span', { class: 'rc-title' }, r.title),
      h('span', { class: 'rc-meta muted small' },
        tr('⏱ {0} min · {1} · {2}{3}', r.time, TOOL_LABEL[r.tool], r.flavorLabel, r.spicy ? ' · 🌶' : '')),
      r.swaps.length ? h('span', { class: 'rc-swap small' }, tr('With a substitute: {0}', r.swaps.map((s) => FOOD_BY_ID[s.foodId].name).join(', '))) : null);
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
        favBtn.lastChild.textContent = !has ? tr(' Saved') : tr(' Save');
        toast(!has ? tr('Saved to favorites') : tr('Removed from favorites'));
      },
    }, '❤', fav ? tr(' Saved') : tr(' Save'));
    details.append(
      h('h4', null, tr('Ingredients')),
      h('ul', { class: 'rc-ingr' }, ...r.ingredients.map((i) => h('li', null, h('b', { class: 'num' }, tr('{0} g', i.grams)), ` ${i.name} `, h('span', { class: 'muted' }, `(${i.household})`)))),
      h('p', { class: 'small muted' }, tr('Spices and staples: {0}, salt and pepper. Used in small amounts — no significant calories.', r.pantry.join(', '))),
      h('h4', null, tr('Instructions')),
      h('ol', { class: 'rc-steps' }, ...r.steps.map((s) => h('li', null, s))),
      h('div', { class: 'row gap wrap' },
        favBtn,
        r.swaps.length ? h('button', {
          class: 'btn btn-small btn-primary',
          onclick: async () => {
            for (const s of r.swaps) await setOverride(day, meal.index, { swap: s });
            toast(tr('The menu was updated to match the recipe'));
            close();
          },
        }, icon('swap', 16), tr('Update the menu to match the recipe')) : null));
    const card = h('article', { class: 'card rc-card' }, head, details);
    return card;
  }

  function drawList() {
    clear(listBox);
    const list = filterRecipes(all, { ...f, q, favIds: favIds() });
    listBox.appendChild(h('p', { class: 'muted small', id: 'rc-count', 'aria-live': 'polite' },
      tr('{0, plural, one {# recipe was} other {# recipes were}} found for this meal', list.length)));
    if (!list.length) {
      listBox.appendChild(h('div', { class: 'empty' },
        h('p', null, tr('No recipes fit all of the filters.')),
        h('button', { class: 'btn btn-small', onclick: () => save({ ...DEFAULT_FILTERS }) }, tr('Reset filters'))));
    }
    list.slice(0, shown).forEach((r) => listBox.appendChild(recipeCard(r)));
    if (list.length > shown) {
      listBox.appendChild(h('button', { class: 'btn btn-block', id: 'rc-more', onclick: () => { shown += PAGE; drawList(); } },
        tr('More recipes ({0})', list.length - shown)));
    }
  }

  function draw() {
    drawPanel();
    drawList();
  }

  const askAI = () => {
    const items = meal.items.map((i) => tr('{0} g {1}', i.grams, FOOD_BY_ID[i.foodId].name)).join(', ');
    const likes = f.cuisines.map((c) => CUISINES.find((x) => x.id === c)?.label).filter(Boolean);
    const text = tr('Give me a new recipe for {0} with these ingredients: {1}.{2}{3}', meal.name, items, likes.length ? tr(' I like the {0} style.', likes.join(tr(' or '))) : '', f.pantryOnly && f.have.length ? tr(' I have at home: {0}.', f.have.join(', ')) : '');
    close();
    window.dispatchEvent(new CustomEvent('app:ask', { detail: { text, extra: { recipeRequest: { meal: meal.name, items: meal.items.map((i) => ({ name: FOOD_BY_ID[i.foodId].name, grams: i.grams })) } } } }));
  };

  body.append(
    h('div', { class: 'rc-top' },
      h('div', { class: 'bf-head' },
        h('h2', null, tr('Recipes for {0}', meal.name)),
        h('button', { class: 'icon-btn', 'aria-label': tr('Close'), onclick: close }, icon('close', 24))),
      h('p', { class: 'muted small' }, tr('Every recipe uses the exact amounts in your meal, so the menu stays balanced.')),
      h('div', { class: 'chips rc-items' }, ...meal.items.map((i) => h('span', { class: 'pill' }, tr('{0} {1} g', FOOD_BY_ID[i.foodId].name, i.grams)))),
      h('div', { class: 'row gap rc-search-row' }, search, filterBtn)),
    panelBox,
    listBox,
    h('button', { class: 'btn btn-ghost btn-block', id: 'rc-ai', onclick: askAI }, icon('sparkle', 18), tr('A brand-new idea from the assistant')));

  document.body.appendChild(el);
  draw();
  return { close };
}
