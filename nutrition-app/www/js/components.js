// Reusable UI pieces: macro rings/bars, meal cards, the swap sheet, metric forms.

import { t as tr, lc } from './i18n.js';
import { h, icon, sheet, toast, fmt, parseNum, ltr, clear, normText } from './util.js';
import { FOOD_BY_ID, household, ROLE_LABEL, canExclude, DIET_NOTES } from './foods.js';
import { alternatives } from './substitutions.js';
import { state, setOverride, excludeFood, today, clearPhotoMeal, aiStatus, addDrink, updateDrink, removeDrink } from './store.js';
import { extraFood, extraOptions, MAX_EXTRAS } from './extras.js';
import { makeDrink, drinkTotals, DRINK_NAMES, SUGAR_TSP_KCAL } from './drinks.js';
import { validBf } from './nutrition.js';
import { openBodyFatEstimator } from './screens/bodyfat.js';
import { openRecipes } from './screens/recipes.js';
import { validRemoval } from './mealplan.js';
import { openCalorieCamera } from './screens/calorie-cam.js';
import { openPaywall } from './screens/paywall.js';
import { canUseAI } from './billing.js';

export function ring(value, target, label, sub) {
  const pct = target > 0 ? Math.min(1, value / target) : 0;
  const over = target > 0 && value > target * 1.05;
  const r = 52;
  const c = 2 * Math.PI * r;
  const wrap = h('div', { class: 'ring' + (over ? ' over' : '') });
  wrap.innerHTML = `<svg viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="${r}" class="ring-bg"/>
    <circle cx="60" cy="60" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" transform="rotate(-90 60 60)"/>
  </svg>`;
  wrap.appendChild(h('div', { class: 'ring-label' },
    h('strong', null, fmt(value)),
    h('span', null, label),
    sub ? h('small', null, sub) : null));
  return wrap;
}

export function macroBar(name, cls, value, target) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return h('div', { class: `macro ${cls}` },
    h('div', { class: 'macro-head' },
      h('span', null, name),
      h('span', { class: 'num' }, tr('{0} / {1} g', fmt(value), fmt(target)))),
    h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': Math.round(value), 'aria-valuemax': Math.round(target), 'aria-label': name },
      h('i', { style: { width: `${pct}%` } })));
}

const SWAP_LABEL = { protein: tr('Swap protein'), carb: tr('Swap carb'), fat: tr('Swap fat'), fruit: tr('Swap fruit'), veg: tr('Swap vegetable') };

export function mealCard(meal, { day, eaten, onToggle, swaps = true, onAsk } = {}) {
  const card = h('section', { class: 'card meal' + (eaten ? ' eaten' : ''), 'data-target-kcal': meal.target.kcal });
  const head = h('div', { class: 'meal-head' },
    h('div', null,
      h('h3', null, meal.name),
      h('div', { class: 'meal-sub num' }, tr('{0} kcal · P {1} · C {2} · F {3}', fmt(meal.totals.kcal), fmt(meal.totals.p), fmt(meal.totals.c), fmt(meal.totals.f)))),
    onToggle ? h('button', {
      class: 'check-btn' + (eaten ? ' on' : ''),
      'aria-pressed': eaten ? 'true' : 'false',
      'aria-label': eaten ? tr('Unmark {0}', meal.name) : tr('Mark {0} as eaten', meal.name),
      onclick: onToggle,
    }, icon('check', 20), h('span', null, eaten ? tr('Eaten') : tr('Mark'))) : null);
  card.appendChild(head);

  // Calorie camera: today and past days only (you photograph what you eat).
  const camOk = day && day <= today();
  if (camOk) {
    card.appendChild(h('button', {
      class: 'btn btn-block mc-open',
      // A paid feature after the trial: locked shows the plan screen instead.
      onclick: () => (canUseAI(aiStatus()) ? openCalorieCamera(meal, day) : openPaywall('camera')),
    }, icon(canUseAI(aiStatus()) ? 'camera' : 'lock', 18), meal.eaten ? tr('Retake with the calorie camera') : tr('Calorie camera — photograph your plate')));
  }
  if (camOk) card.appendChild(drinksBlock(meal, day));
  if (meal.eaten) return photoMealBody(card, meal, day);

  const list = h('ul', { class: 'items' });
  for (const it of meal.items) {
    const food = FOOD_BY_ID[it.foodId];
    const li = h('li', { class: `item role-${it.role}` },
      h('div', { class: 'item-main' },
        h('span', { class: 'role-dot', title: ROLE_LABEL[it.role] }),
        h('div', { class: 'item-text' },
          h('div', { class: 'item-name' }, food.name),
          h('div', { class: 'item-amt' },
            h('b', { class: 'num' }, tr('{0} g', fmt(it.grams))),
            h('span', null, ` · ${household(food, it.grams)}`),
            h('span', { class: 'muted num' }, tr(' · {0} kcal', it.kcal))))));
    if (swaps) {
      li.appendChild(h('button', {
        class: 'chip-btn',
        onclick: () => openSwapSheet(it, meal, day, onAsk),
      }, icon('swap', 16), SWAP_LABEL[it.role]));
    }
    list.appendChild(li);
  }
  card.appendChild(list);
  if (day && swaps) card.appendChild(extrasBlock(meal, day));
  if (day && swaps && meal.removable) card.appendChild(removalBar(meal, day));
  if (day) {
    card.appendChild(h('button', {
      class: 'btn btn-block rc-open',
      onclick: () => openRecipes(meal, day),
    }, h('span', { 'aria-hidden': 'true' }, '🍳'), tr('Recipes for this meal')));
  }
  return card;
}

// ---------- drinks ----------
// "What did you drink?" under every meal (today and past days). Free text,
// plus two optional numbers: teaspoons of sugar per cup, and how many cups.
// Drinks count toward the day's calories as soon as they're added.
function ensureDrinkNames() {
  if (document.getElementById('drink-names')) return;
  const dl = h('datalist', { id: 'drink-names' }, ...DRINK_NAMES.map((n) => h('option', { value: n })));
  document.body.appendChild(dl);
}

// Open/closed state of each meal's drinks heading, kept across redraws.
const drinksOpen = new Set();

function drinksBlock(meal, day) {
  ensureDrinkNames();
  const list = (state.logs[day] && state.logs[day].drinks && state.logs[day].drinks[meal.index]) || [];
  const id = `${day}|${meal.index}`;
  const open = drinksOpen.has(id);
  const total = list.reduce((s, d) => s + drinkTotals(d).kcal, 0);
  const wrap = h('div', { class: 'drinks' + (open ? ' open' : ''), 'data-meal': meal.index });
  // A heading like the food groups: closed it shows what was logged, open it asks.
  const body = h('div', { class: 'drinks-body', hidden: !open });
  wrap.appendChild(h('button', {
    type: 'button', class: 'drinks-head', 'aria-expanded': open ? 'true' : 'false',
    onclick: (e) => {
      const nowOpen = body.hidden;
      body.hidden = !nowOpen;
      wrap.classList.toggle('open', nowOpen);
      e.currentTarget.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
      if (nowOpen) { drinksOpen.add(id); body.querySelector('.drink-name')?.focus(); } else drinksOpen.delete(id);
    },
  },
    h('span', { class: 'role-dot role-drink' }),
    h('span', { class: 'drinks-title' }, tr('Drinks')),
    list.length ? h('span', { class: 'drinks-sum muted num' }, tr('{0} · {1} kcal', list.length === 1 ? list[0].name : tr('{0, plural, one {# drink} other {# drinks}}', list.length), total)) : h('span', { class: 'drinks-sum muted' }, tr('What did you drink?')),
    h('span', { class: 'drinks-chev', 'aria-hidden': 'true' }, icon('forward', 16))));
  wrap.appendChild(body);
  list.forEach((d, at) => {
    const t = drinkTotals(d);
    const detail = [d.count !== 1 ? tr('{0, plural, one {# cup} other {# cups}}', fmt(d.count)) : null, d.sugar ? tr('{0, plural, one {# teaspoon of sugar} other {# teaspoons of sugar}}', fmt(d.sugar)) : null].filter(Boolean).join(' · ');
    const row = h('div', { class: 'drink-row' },
      h('div', { class: 'drink-text' },
        h('b', null, d.name),
        detail ? h('span', { class: 'muted' }, ` · ${detail}`) : null),
      h('span', { class: 'drink-kcal num' }, tr('{0} kcal', t.kcal)),
      h('button', { type: 'button', class: 'icon-btn drink-del', 'aria-label': tr('Remove {0}', d.name), onclick: () => removeDrink(day, meal.index, at) }, icon('close', 16)));
    body.appendChild(row);
    if (d.unknown) {
      // Not in the table: the person can say how many calories a cup has.
      const kc = h('input', { class: 'drink-kcal-in', type: 'text', inputmode: 'numeric', placeholder: '0', value: d.kcalCup || '', 'aria-label': tr('Calories per cup') });
      kc.addEventListener('change', () => updateDrink(day, meal.index, at, { kcalCup: Math.max(0, parseNum(kc.value) || 0) }));
      body.appendChild(h('label', { class: 'drink-unknown small muted' }, tr('I didn\'t recognize this drink. How many kcal are in one cup? '), kc));
    }
  });
  const name = h('input', { class: 'drink-name', type: 'text', list: 'drink-names', maxlength: 40, autocomplete: 'off', placeholder: tr('What did you drink? (coffee, chocolate milk, cola…)'), 'aria-label': tr('What did you drink') });
  const sugar = h('input', { class: 'drink-sugar', type: 'text', inputmode: 'decimal', placeholder: '0', 'aria-label': tr('Teaspoons of sugar') });
  const count = h('input', { class: 'drink-count', type: 'text', inputmode: 'decimal', placeholder: '1', 'aria-label': tr('How many cups') });
  const add = async () => {
    if (!name.value.trim()) { toast(tr('Write what you drank')); name.focus(); return; }
    const drink = makeDrink({ text: name.value, sugar: parseNum(sugar.value) || 0, count: parseNum(count.value) || 1 });
    await addDrink(day, meal.index, drink);
    toast(drink.unknown ? tr('Added. I didn\'t recognize the drink — you can enter its calories.') : tr('Added: {0} kcal', drinkTotals(drink).kcal));
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  body.appendChild(h('div', { class: 'drink-form' },
    name,
    h('div', { class: 'drink-opts' },
      h('label', null, h('span', null, tr('Sugar (teaspoons)')), sugar),
      h('label', null, h('span', null, tr('How many cups')), count),
      h('button', { type: 'button', class: 'btn btn-small drink-add', onclick: add }, icon('plus', 16), tr('Add')))));
  return wrap;
}

// ---------- sauces and cheese ----------
// Added by the person; their calories come off the rest of the meal.
function extrasBlock(meal, day) {
  const wrap = h('div', { class: 'extras' });
  const cur = (meal.extras || []).map(({ foodId, grams }) => ({ foodId, grams }));
  if (cur.length) {
    const ul = h('ul', { class: 'extras-list' });
    meal.extras.forEach((e, at) => {
      const f = extraFood(e.foodId);
      const half = Math.max(1, Math.round((f.serving || e.grams) / 2));
      const set = (grams) => setOverride(day, meal.index, { extras: cur.map((x, i) => (i === at ? { ...x, grams } : x)).filter((x) => x.grams > 0) });
      ul.appendChild(h('li', { class: 'extra' },
        h('div', { class: 'extra-text' },
          h('div', { class: 'item-name' }, f.name),
          h('div', { class: 'item-amt' },
            h('b', { class: 'num' }, tr('{0} g', fmt(e.grams))),
            h('span', null, ` · ${household(f, e.grams)}`),
            h('span', { class: 'muted num' }, tr(' · {0} kcal', e.kcal)))),
        h('div', { class: 'extra-ctl' },
          h('button', { type: 'button', class: 'icon-btn extra-minus', 'aria-label': tr('Less'), onclick: () => set(e.grams - half) }, icon('minus', 16)),
          h('button', { type: 'button', class: 'icon-btn extra-plus', 'aria-label': tr('More'), onclick: () => set(e.grams + half) }, icon('plus', 16)),
          h('button', { type: 'button', class: 'icon-btn extra-del', 'aria-label': tr('Remove {0}', f.name), onclick: () => set(0) }, icon('close', 16)))));
    });
    wrap.appendChild(ul);
    const kcal = meal.extras.reduce((s, e) => s + e.kcal, 0);
    wrap.appendChild(h('p', { class: 'extras-note small' }, icon('info', 16), h('span', null, tr('{0} kcal from additions were taken off the rest of the meal, so the meal keeps the same calories.', fmt(kcal)))));
  }
  wrap.appendChild(h('button', {
    type: 'button', class: 'btn btn-block btn-ghost extras-add',
    onclick: () => (cur.length >= MAX_EXTRAS ? toast(tr('You can add up to {0} additions to a meal', MAX_EXTRAS)) : openExtrasSheet(meal, day)),
  }, icon('plus', 18), tr('Add a sauce or cheese')));
  return wrap;
}

function openExtrasSheet(meal, day) {
  const mealFoods = meal.items.map((i) => FOOD_BY_ID[i.foodId]);
  const opts = extraOptions(state.profile.prefs, mealFoods);
  const have = new Set((meal.extras || []).map((e) => e.foodId));
  sheet(tr('Add a sauce or cheese'), (close) => {
    const search = h('input', { class: 'search', id: 'extra-search', type: 'search', placeholder: tr('Search: mustard, tahini, cottage cheese…'), autocomplete: 'off', 'aria-label': tr('Search') });
    const list = h('div', { class: 'extra-opts' });
    const draw = () => {
      clear(list);
      const q = normText(search.value);
      const hit = opts.filter((o) => !q || normText(`${o.food.name} ${(o.food.aliases || []).join(' ')}`).includes(q));
      if (!hit.length) { list.appendChild(h('p', { class: 'empty' }, tr('Nothing found. Try another word.'))); return; }
      let lastGroup = '';
      for (const o of hit) {
        const g = o.light ? 'light' : o.group;
        if (g !== lastGroup) {
          lastGroup = g;
          list.appendChild(h('h4', { class: 'extra-group' }, { light: tr('Low-calorie'), sauce: tr('More sauces'), cheese: tr('Cheeses') }[g]));
        }
        list.appendChild(h('div', { class: 'alt extra-opt' },
          h('div', { class: 'alt-text' },
            h('div', { class: 'alt-name' }, o.food.name),
            h('div', { class: 'muted small num' }, tr('{0} · {1} g · {2} kcal', household(o.food, o.serving), o.serving, o.kcal))),
          h('button', {
            type: 'button', class: 'btn btn-small btn-primary', disabled: have.has(o.food.id),
            onclick: async () => {
              const next = [...(meal.extras || []).map(({ foodId, grams }) => ({ foodId, grams })), { foodId: o.food.id, grams: o.serving }];
              await setOverride(day, meal.index, { extras: next });
              close();
              toast(tr('{0} added — {1} kcal taken off the rest of the meal', o.food.name, o.kcal));
            },
          }, have.has(o.food.id) ? tr('Added') : tr('Add'))));
      }
    };
    search.addEventListener('input', draw);
    draw();
    return h('div', null,
      h('p', { class: 'muted small' }, tr('The addition\'s calories come off the rest of the meal, so the meal stays on the same budget. Low-calorie options come first.')),
      search, list);
  });
}

// A meal replaced by what the calorie camera saw: those items, read-only, with
// a way back to the planned meal.
function photoMealBody(card, meal, day) {
  card.classList.add('photo-meal');
  card.appendChild(h('div', { class: 'mc-badge' }, icon('camera', 14), tr('From the photo · '), h('span', { class: 'num' }, tr('In the menu: {0} kcal', fmt(meal.plannedTotals.kcal)))));
  const list = h('ul', { class: 'items' });
  for (const it of meal.eaten.items) {
    const food = it.foodId && FOOD_BY_ID[it.foodId];
    list.appendChild(h('li', { class: `item role-${food ? food.role : 'photo'}` },
      h('div', { class: 'item-main' },
        h('span', { class: 'role-dot', title: food ? ROLE_LABEL[food.role] : tr('From the photo') }),
        h('div', { class: 'item-text' },
          h('div', { class: 'item-name' }, it.name),
          h('div', { class: 'item-amt' },
            h('b', { class: 'num' }, tr('{0} g', fmt(it.grams))),
            food ? h('span', null, ` · ${household(food, it.grams)}`) : null,
            h('span', { class: 'muted num' }, tr(' · {0} kcal', it.kcal)))))));
  }
  card.appendChild(list);
  if (day) {
    card.appendChild(h('button', {
      class: 'btn btn-ghost btn-block btn-small',
      onclick: async () => { await clearPhotoMeal(day, meal.index); toast(tr('Back to the meal from the menu')); },
    }, tr('Back to the planned meal')));
  }
  return card;
}

const REMOVE_LABEL = { protein: tr('No protein'), carb: tr('No carbs'), fat: tr('No fat'), veg: tr('No vegetables'), fruit: tr('No fruit') };
const SIDE_NAME = { veg: tr('the vegetables'), fruit: tr('the fruit') };
const REMOVED_TEXT = { protein: tr('Protein removed'), carb: tr('Carbs removed'), fat: tr('Fat removed') };
const BACK_TEXT = { protein: tr('Protein is back in the meal'), carb: tr('Carbs are back in the meal'), fat: tr('Fat is back in the meal'), veg: tr('The vegetables are back in the meal'), fruit: tr('The fruit is back in the meal') };
const MACRO_NAME = { protein: tr('Protein'), carb: tr('Carbs'), fat: tr('Fat') };

// What the meal's removals become when the user taps group g. Protein, carbs
// and fat go one at a time, so picking a second one swaps it for the first.
export function nextRemoval(meal, g) {
  const cur = meal.removed || [];
  if (cur.includes(g)) return cur.filter((x) => x !== g);
  let want = [...cur, g];
  if (!validRemoval(meal.removable, want).includes(g)) want = [...cur.filter((x) => !MACRO_NAME[x]), g];
  return validRemoval(meal.removable, want).includes(g) ? want : null;
}

// "Without carbs / protein / fat / vegetables" toggles under a meal. The
// removed group's calories are shared among the remaining macros.
function removalBar(meal, day) {
  const removed = meal.removed || [];
  const chips = h('div', { class: 'rm-chips', role: 'group', 'aria-label': tr('Take out of the meal') });
  for (const g of meal.removable) {
    const on = removed.includes(g);
    const next = nextRemoval(meal, g);
    chips.appendChild(h('button', {
      type: 'button',
      class: 'rm-chip' + (on ? ' on' : '') + (next ? '' : ' blocked'),
      'data-group': g,
      'aria-pressed': on ? 'true' : 'false',
      'aria-disabled': next ? null : 'true',
      onclick: async () => {
        if (!next) {
          toast(g === 'protein'
            ? tr('Can\'t remove the protein here — the meal would be left with only fat.')
            : tr('Can\'t remove this from this meal.'));
          return;
        }
        await setOverride(day, meal.index, { removed: next });
        if (on) toast(BACK_TEXT[g]);
        else toast(tr('{0} without {1} — the calories were redistributed', meal.name, lc(MACRO_NAME[g] || { veg: tr('Vegetables'), fruit: tr('Fruit') }[g])));
      },
    }, on ? icon('check', 14) : null, REMOVE_LABEL[g]));
  }
  const wrap = h('div', { class: 'rm-bar' },
    h('div', { class: 'rm-title muted small' }, tr('Take out of the meal:')),
    chips);
  if (removed.length) {
    const macros = removed.filter((g) => MACRO_NAME[g]);
    const sides = removed.filter((g) => SIDE_NAME[g]).map((g) => SIDE_NAME[g]);
    const rest = ['protein', 'carb', 'fat'].filter((g) => meal.removable.includes(g) && !macros.includes(g)).map((g) => MACRO_NAME[g]);
    const to = rest.length > 1 ? tr('split between the {0} and the {1}', rest[0], rest[1]) : tr('moved to the {0}', rest[0]);
    const text = macros.length
      ? tr('{0}{1} — {2} kcal {3}, and the meal keeps the same calories.', REMOVED_TEXT[macros[0]], sides.length ? tr(' and also {0}', sides.join(tr(' and '))) : '', fmt(meal.freedKcal), to)
      : tr('{0} {1} — the rest of the meal was increased to keep the same calories.', sides.join(tr(' and ')), sides.length > 1 || removed[0] === 'veg' ? tr('were removed') : tr('was removed'));
    wrap.appendChild(h('p', { class: 'rm-note small' }, icon('info', 16), h('span', null, text)));
  }
  return wrap;
}

export function openSwapSheet(item, meal, day, onAsk) {
  const SHOWN = 6;
  const res = alternatives(item, meal, state.profile.prefs, Infinity, { all: true });
  const keyName = { p: tr('Protein'), c: tr('Carbs'), f: tr('Fat'), kcal: tr('Calories') }[res.matchedOn];
  const s = sheet(`${SWAP_LABEL[item.role]}: ${res.source.name}`, (close) => {
    const body = h('div', null,
      h('p', { class: 'muted small' },
        tr('Instead of {0} g ({1}) — {2} kcal. The substitutes are matched to the same amount of {3} and filtered by your restrictions.', res.source.grams, res.source.household, res.source.kcal, keyName)));
    if (!res.options.length) {
      body.appendChild(h('p', { class: 'empty' }, tr('No suitable substitutes in the database for your restrictions. You can ask the assistant.')));
    }
    const list = h('ul', { class: 'alt-list' });
    const row = (o) => h('li', { class: 'alt', 'data-food': o.foodId },
      h('div', { class: 'alt-text' },
        h('div', { class: 'alt-name' }, o.name),
        h('div', { class: 'alt-amt' }, h('b', { class: 'num' }, tr('{0} g', o.grams)), ` · ${o.household}`),
        h('div', { class: 'muted small num' },
          tr('{0} kcal ', o.kcal), ltr(`(${o.dKcal > 0 ? '+' : ''}${o.dKcal})`), tr(' · P {0} · C {1} · F {2}', fmt(o.p, 1), fmt(o.c, 1), fmt(o.f, 1)))),
      h('button', {
        class: 'btn btn-small btn-primary',
        onclick: async () => {
          await setOverride(day, meal.index, { swap: { slot: item.slot, foodId: o.foodId, grams: o.grams } });
          close();
          toast(tr('Swapped to {0}', o.name));
        },
      }, tr('Swap')));
    // Search: typing a name shows every matching food (all of the kind, not
    // just the first few); empty shows the usual short list.
    const search = h('input', { class: 'search', id: 'alt-search', type: 'search', placeholder: tr('Search foods…'), autocomplete: 'off', 'aria-label': tr('Search foods') });
    body.insertBefore(search, body.firstChild);
    body.appendChild(list);
    let expanded = false;
    const more = h('button', {
      class: 'btn btn-block alt-all',
      id: 'btn-all-alts',
      onclick: () => {
        expanded = true;
        draw();
        list.children[SHOWN]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    }, tr('Show all options ({0})', res.options.length));
    const draw = () => {
      clear(list);
      const q = normText(search.value);
      const names = (o) => normText(`${o.name} ${(FOOD_BY_ID[o.foodId] && FOOD_BY_ID[o.foodId].aliases || []).join(' ')}`);
      const hit = q ? res.options.filter((o) => names(o).includes(q)) : expanded ? res.options : res.options.slice(0, SHOWN);
      for (const o of hit) list.appendChild(row(o));
      if (!hit.length) list.appendChild(h('li', { class: 'empty' }, tr('No such food among the substitutes. Try another word.')));
      if (expanded) more.remove();
      more.hidden = !!q || res.options.length <= SHOWN;
    };
    search.addEventListener('input', draw);
    draw();
    body.appendChild(more);
    body.appendChild(h('button', {
      class: 'btn btn-ghost btn-block danger-text',
      id: 'btn-never',
      onclick: async () => {
        if (!canExclude(item.foodId, state.profile.prefs)) {
          toast(tr('Can\'t exclude this one too — at least 2 options of each kind must stay so there is always a substitute.'));
          return;
        }
        await excludeFood(item.foodId);
        close();
        toast(tr('{0} was removed from your menu for good. You can bring it back in Profile → Food preferences.', res.source.name));
      },
    }, icon('close', 18), tr('I don\'t eat this — remove it from my menu')));
    if (onAsk) {
      body.appendChild(h('button', {
        class: 'btn btn-ghost btn-block',
        onclick: () => { close(); onAsk(item, meal, { ...res, options: res.options.slice(0, SHOWN) }); },
      }, icon('chat', 18), tr('Ask the assistant about more substitutes')));
    }
    return body;
  });
  return s;
}

// Weight + body-fat form with validation; used by the weekly gate and Profile.
// person(): { sex, age, height } for the body-fat estimator (optional).
export function metricsForm({ weight, bf, submitLabel = tr('Save'), onSubmit, previous, person }) {
  const wIn = h('input', { id: 'm-weight', type: 'text', inputmode: 'decimal', autocomplete: 'off', required: true, value: weight ?? '', 'aria-describedby': 'm-weight-err', placeholder: tr('For example 72.5') });
  const bIn = h('input', { id: 'm-bf', type: 'text', inputmode: 'decimal', autocomplete: 'off', required: true, value: bf ?? '', 'aria-describedby': 'm-bf-err', placeholder: tr('For example 18') });
  const wErr = h('div', { class: 'field-err', id: 'm-weight-err', role: 'alert' });
  const bErr = h('div', { class: 'field-err', id: 'm-bf-err', role: 'alert' });
  const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, submitLabel);
  const form = h('form', { class: 'form', novalidate: true },
    h('label', { class: 'field' }, h('span', null, tr('Current weight (kg)')), wIn, wErr),
    h('label', { class: 'field' }, h('span', null, tr('Current body fat (%)')), bIn, bErr,
      h('small', { class: 'muted' }, tr('An estimate from a smart scale, calipers or a professional measurement. Measure under the same conditions every week.'))),
    person ? h('button', {
      type: 'button',
      class: 'btn btn-ghost btn-block bf-link',
      id: 'm-bf-estimate',
      onclick: async () => {
        const w = parseNum(wIn.value);
        const p = person();
        const v = await openBodyFatEstimator({ ...p, weight: w >= 30 && w <= 300 ? w : (previous && previous.weight) || 70 });
        if (v !== null) { bIn.value = String(v); bErr.textContent = ''; bIn.setAttribute('aria-invalid', 'false'); }
      },
    }, icon('camera', 18), tr('Don\'t know your body fat? Estimate from photos')) : null,
    btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const w = parseNum(wIn.value);
    const b = parseNum(bIn.value);
    let ok = true;
    wErr.textContent = '';
    bErr.textContent = '';
    if (!(w >= 30 && w <= 300)) { wErr.textContent = tr('Enter a weight between 30 and 300 kg.'); ok = false; }
    if (!validBf(b)) { bErr.textContent = tr('Enter a body fat between 3 and 60%.'); ok = false; }
    wIn.setAttribute('aria-invalid', wErr.textContent ? 'true' : 'false');
    bIn.setAttribute('aria-invalid', bErr.textContent ? 'true' : 'false');
    if (ok && previous && Math.abs(w - previous.weight) > previous.weight * 0.1) {
      if (!form.dataset.confirmJump) {
        form.dataset.confirmJump = '1';
        wErr.textContent = tr('That is a change of {0} kg from the previous measurement. If it is right, tap again to confirm.', Math.abs(w - previous.weight).toFixed(1));
        return;
      }
    }
    if (!ok) return;
    btn.disabled = true;
    try {
      await onSubmit(w, b);
    } finally {
      btn.disabled = false;
    }
  });
  return form;
}

export function segmented(options, value, onChange, name) {
  const wrap = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': name });
  for (const o of options) {
    const b = h('button', {
      type: 'button',
      role: 'radio',
      'aria-checked': o.id === value ? 'true' : 'false',
      class: o.id === value ? 'on' : '',
      onclick: () => {
        wrap.querySelectorAll('button').forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
        b.classList.add('on');
        b.setAttribute('aria-checked', 'true');
        onChange(o.id);
      },
    }, o.label);
    wrap.appendChild(b);
  }
  return wrap;
}

export function stepper(value, min, max, onChange, label) {
  let v = value;
  const out = h('output', { class: 'num', 'aria-live': 'polite' }, String(v));
  const set = (n) => { v = Math.max(min, Math.min(max, n)); out.textContent = String(v); onChange(v); };
  return h('div', { class: 'stepper', role: 'group', 'aria-label': label },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': tr('Subtract'), onclick: () => set(v - 1) }, icon('minus')),
    out,
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': tr('Add‖components'), onclick: () => set(v + 1) }, icon('plus')));
}

export function assessmentBox(a, onApply) {
  if (!a || (a.level === 'ok' && !a.messages.length)) {
    return h('div', { class: 'notice ok' }, icon('check', 18), h('span', null, tr('The target is realistic and safe for the chosen period.')));
  }
  const box = h('div', { class: `notice ${a.level}`, role: 'alert' },
    h('div', null, ...a.messages.map((m) => h('p', null, m))));
  if (a.suggestion && onApply) {
    const s = a.suggestion;
    const opts = h('div', { class: 'row gap wrap' });
    if (s.weeks) opts.appendChild(h('button', { type: 'button', class: 'btn btn-small', onclick: () => onApply({ weeks: s.weeks }) }, tr('Extend to {0} weeks', s.weeks)));
    if (s.targetWeight) opts.appendChild(h('button', { type: 'button', class: 'btn btn-small', onclick: () => onApply({ targetWeight: s.targetWeight }) }, tr('Target {0} kg', s.targetWeight)));
    if (s.targetBf) opts.appendChild(h('button', { type: 'button', class: 'btn btn-small', onclick: () => onApply({ targetBf: s.targetBf }) }, tr('Target body fat {0}%', s.targetBf)));
    box.appendChild(h('div', null, h('p', { class: 'small' }, tr('A realistic suggestion:')), opts));
  }
  return box;
}

export function disclaimer() {
  return h('p', { class: 'disclaimer' }, icon('info', 16),
    tr('The information in the app is general and is not medical advice. For a medical condition, pregnancy, an eating disorder or if you take medication, consult a doctor or a clinical dietitian.'));
}

// Explains what keto / carnivore mean, under the diet picker.
export function dietNoteBox(diet) {
  const el = h('p', { class: 'notice warn small diet-note', 'aria-live': 'polite' });
  const update = (v) => {
    el.textContent = DIET_NOTES[v] || '';
    el.hidden = !DIET_NOTES[v];
  };
  update(diet);
  return { el, update };
}

// The profile picture, or the first letter of the nickname / name on a tinted
// circle when there is none. Object URLs are freed once the image has loaded.
export function avatar(size = 40) {
  const p = state.profile || {};
  const label = (p.nickname || p.name || '').trim();
  const el = h('span', { class: 'avatar', style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.42)}px` } });
  if (state.avatar && state.avatar.blob) {
    const url = URL.createObjectURL(state.avatar.blob);
    el.appendChild(h('img', { src: url, alt: '', onload: () => setTimeout(() => URL.revokeObjectURL(url), 1000) }));
  } else {
    el.appendChild(h('span', { 'aria-hidden': 'true' }, label ? [...label][0] : '🙂'));
  }
  return el;
}
