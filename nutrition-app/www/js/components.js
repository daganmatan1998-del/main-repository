// Reusable UI pieces: macro rings/bars, meal cards, the swap sheet, metric forms.

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
      h('span', { class: 'num' }, `${fmt(value)} / ${fmt(target)} ג׳`)),
    h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': Math.round(value), 'aria-valuemax': Math.round(target), 'aria-label': name },
      h('i', { style: { width: `${pct}%` } })));
}

const SWAP_LABEL = { protein: 'החלף חלבון', carb: 'החלף פחמימה', fat: 'החלף שומן', fruit: 'החלף פרי', veg: 'החלף ירק' };

export function mealCard(meal, { day, eaten, onToggle, swaps = true, onAsk } = {}) {
  const card = h('section', { class: 'card meal' + (eaten ? ' eaten' : ''), 'data-target-kcal': meal.target.kcal });
  const head = h('div', { class: 'meal-head' },
    h('div', null,
      h('h3', null, meal.name),
      h('div', { class: 'meal-sub num' }, `${fmt(meal.totals.kcal)} קק״ל · ח ${fmt(meal.totals.p)} · פ ${fmt(meal.totals.c)} · ש ${fmt(meal.totals.f)}`)),
    onToggle ? h('button', {
      class: 'check-btn' + (eaten ? ' on' : ''),
      'aria-pressed': eaten ? 'true' : 'false',
      'aria-label': eaten ? `בטל סימון ${meal.name}` : `סמן ${meal.name} כנאכלה`,
      onclick: onToggle,
    }, icon('check', 20), h('span', null, eaten ? 'נאכל' : 'סמן')) : null);
  card.appendChild(head);

  // Calorie camera: today and past days only (you photograph what you eat).
  const camOk = day && day <= today();
  if (camOk) {
    card.appendChild(h('button', {
      class: 'btn btn-block mc-open',
      // A paid feature after the trial: locked shows the plan screen instead.
      onclick: () => (canUseAI(aiStatus()) ? openCalorieCamera(meal, day) : openPaywall('camera')),
    }, icon(canUseAI(aiStatus()) ? 'camera' : 'lock', 18), meal.eaten ? 'צילום מחדש במצלמת הקלוריות' : 'מצלמת קלוריות — צלמו את הצלחת'));
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
            h('b', { class: 'num' }, `${fmt(it.grams)} ג׳`),
            h('span', null, ` · ${household(food, it.grams)}`),
            h('span', { class: 'muted num' }, ` · ${it.kcal} קק״ל`)))));
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
    }, h('span', { 'aria-hidden': 'true' }, '🍳'), 'מתכונים לארוחה'));
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

function drinksBlock(meal, day) {
  ensureDrinkNames();
  const list = (state.logs[day] && state.logs[day].drinks && state.logs[day].drinks[meal.index]) || [];
  const wrap = h('div', { class: 'drinks', 'data-meal': meal.index });
  wrap.appendChild(h('div', { class: 'drinks-title' }, h('span', { 'aria-hidden': 'true' }, '🥤'), 'שתייה'));
  list.forEach((d, at) => {
    const t = drinkTotals(d);
    const detail = [d.count !== 1 ? `${fmt(d.count)} כוסות` : null, d.sugar ? `${fmt(d.sugar)} כפיות סוכר` : null].filter(Boolean).join(' · ');
    const row = h('div', { class: 'drink-row' },
      h('div', { class: 'drink-text' },
        h('b', null, d.name),
        detail ? h('span', { class: 'muted' }, ` · ${detail}`) : null),
      h('span', { class: 'drink-kcal num' }, `${t.kcal} קק״ל`),
      h('button', { type: 'button', class: 'icon-btn drink-del', 'aria-label': `הסרת ${d.name}`, onclick: () => removeDrink(day, meal.index, at) }, icon('close', 16)));
    wrap.appendChild(row);
    if (d.unknown) {
      // Not in the table: the person can say how many calories a cup has.
      const kc = h('input', { class: 'drink-kcal-in', type: 'text', inputmode: 'numeric', placeholder: '0', value: d.kcalCup || '', 'aria-label': 'קלוריות לכוס' });
      kc.addEventListener('change', () => updateDrink(day, meal.index, at, { kcalCup: Math.max(0, parseNum(kc.value) || 0) }));
      wrap.appendChild(h('label', { class: 'drink-unknown small muted' }, 'לא זיהיתי את המשקה. כמה קק״ל יש בכוס אחת? ', kc));
    }
  });
  const name = h('input', { class: 'drink-name', type: 'text', list: 'drink-names', maxlength: 40, autocomplete: 'off', placeholder: 'מה שתיתם? (קפה, שוקו, קולה…)', 'aria-label': 'מה שתיתם' });
  const sugar = h('input', { class: 'drink-sugar', type: 'text', inputmode: 'decimal', placeholder: '0', 'aria-label': 'כפיות סוכר' });
  const count = h('input', { class: 'drink-count', type: 'text', inputmode: 'decimal', placeholder: '1', 'aria-label': 'כמה כוסות' });
  const add = async () => {
    if (!name.value.trim()) { toast('כתבו מה שתיתם'); name.focus(); return; }
    const drink = makeDrink({ text: name.value, sugar: parseNum(sugar.value) || 0, count: parseNum(count.value) || 1 });
    await addDrink(day, meal.index, drink);
    toast(drink.unknown ? 'נוסף. לא זיהיתי את המשקה — אפשר להזין את הקלוריות שלו.' : `נוסף: ${drinkTotals(drink).kcal} קק״ל`);
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  wrap.appendChild(h('div', { class: 'drink-form' },
    name,
    h('div', { class: 'drink-opts' },
      h('label', null, h('span', null, 'סוכר (כפיות)'), sugar),
      h('label', null, h('span', null, 'כמה כוסות'), count),
      h('button', { type: 'button', class: 'btn btn-small drink-add', onclick: add }, icon('plus', 16), 'הוספה'))));
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
            h('b', { class: 'num' }, `${fmt(e.grams)} ג׳`),
            h('span', null, ` · ${household(f, e.grams)}`),
            h('span', { class: 'muted num' }, ` · ${e.kcal} קק״ל`))),
        h('div', { class: 'extra-ctl' },
          h('button', { type: 'button', class: 'icon-btn extra-minus', 'aria-label': 'פחות', onclick: () => set(e.grams - half) }, icon('minus', 16)),
          h('button', { type: 'button', class: 'icon-btn extra-plus', 'aria-label': 'יותר', onclick: () => set(e.grams + half) }, icon('plus', 16)),
          h('button', { type: 'button', class: 'icon-btn extra-del', 'aria-label': `הסרת ${f.name}`, onclick: () => set(0) }, icon('close', 16)))));
    });
    wrap.appendChild(ul);
    const kcal = meal.extras.reduce((s, e) => s + e.kcal, 0);
    wrap.appendChild(h('p', { class: 'extras-note small' }, icon('info', 16), h('span', null, `${fmt(kcal)} קק״ל מהתוספות הופחתו משאר הארוחה, והארוחה נשארת על אותן קלוריות.`)));
  }
  wrap.appendChild(h('button', {
    type: 'button', class: 'btn btn-block btn-ghost extras-add',
    onclick: () => (cur.length >= MAX_EXTRAS ? toast(`אפשר להוסיף עד ${MAX_EXTRAS} תוספות לארוחה`) : openExtrasSheet(meal, day)),
  }, icon('plus', 18), 'הוספת רוטב או גבינה'));
  return wrap;
}

function openExtrasSheet(meal, day) {
  const mealFoods = meal.items.map((i) => FOOD_BY_ID[i.foodId]);
  const opts = extraOptions(state.profile.prefs, mealFoods);
  const have = new Set((meal.extras || []).map((e) => e.foodId));
  sheet('הוספת רוטב או גבינה', (close) => {
    const search = h('input', { class: 'search', id: 'extra-search', type: 'search', placeholder: 'חיפוש: חרדל, טחינה, קוטג׳…', autocomplete: 'off', 'aria-label': 'חיפוש' });
    const list = h('div', { class: 'extra-opts' });
    const draw = () => {
      clear(list);
      const q = normText(search.value);
      const hit = opts.filter((o) => !q || normText(`${o.food.name} ${(o.food.aliases || []).join(' ')}`).includes(q));
      if (!hit.length) { list.appendChild(h('p', { class: 'empty' }, 'לא נמצא. נסו מילה אחרת.')); return; }
      let lastGroup = '';
      for (const o of hit) {
        const g = o.light ? 'light' : o.group;
        if (g !== lastGroup) {
          lastGroup = g;
          list.appendChild(h('h4', { class: 'extra-group' }, { light: 'דלי קלוריות', sauce: 'רטבים נוספים', cheese: 'גבינות' }[g]));
        }
        list.appendChild(h('div', { class: 'alt extra-opt' },
          h('div', { class: 'alt-text' },
            h('div', { class: 'alt-name' }, o.food.name),
            h('div', { class: 'muted small num' }, `${household(o.food, o.serving)} · ${o.serving} ג׳ · ${o.kcal} קק״ל`)),
          h('button', {
            type: 'button', class: 'btn btn-small btn-primary', disabled: have.has(o.food.id),
            onclick: async () => {
              const next = [...(meal.extras || []).map(({ foodId, grams }) => ({ foodId, grams })), { foodId: o.food.id, grams: o.serving }];
              await setOverride(day, meal.index, { extras: next });
              close();
              toast(`${o.food.name} נוסף — ${o.kcal} קק״ל הופחתו משאר הארוחה`);
            },
          }, have.has(o.food.id) ? 'נוסף' : 'הוספה')));
      }
    };
    search.addEventListener('input', draw);
    draw();
    return h('div', null,
      h('p', { class: 'muted small' }, 'הקלוריות של התוספת יורדות משאר הארוחה, כך שהארוחה נשארת על אותו תקציב. הדלי קלוריות מופיעים ראשונים.'),
      search, list);
  });
}

// A meal replaced by what the calorie camera saw: those items, read-only, with
// a way back to the planned meal.
function photoMealBody(card, meal, day) {
  card.classList.add('photo-meal');
  card.appendChild(h('div', { class: 'mc-badge' }, icon('camera', 14), 'לפי הצילום · ', h('span', { class: 'num' }, `בתפריט: ${fmt(meal.plannedTotals.kcal)} קק״ל`)));
  const list = h('ul', { class: 'items' });
  for (const it of meal.eaten.items) {
    const food = it.foodId && FOOD_BY_ID[it.foodId];
    list.appendChild(h('li', { class: `item role-${food ? food.role : 'photo'}` },
      h('div', { class: 'item-main' },
        h('span', { class: 'role-dot', title: food ? ROLE_LABEL[food.role] : 'מהצילום' }),
        h('div', { class: 'item-text' },
          h('div', { class: 'item-name' }, it.name),
          h('div', { class: 'item-amt' },
            h('b', { class: 'num' }, `${fmt(it.grams)} ג׳`),
            food ? h('span', null, ` · ${household(food, it.grams)}`) : null,
            h('span', { class: 'muted num' }, ` · ${it.kcal} קק״ל`))))));
  }
  card.appendChild(list);
  if (day) {
    card.appendChild(h('button', {
      class: 'btn btn-ghost btn-block btn-small',
      onclick: async () => { await clearPhotoMeal(day, meal.index); toast('חזרה לארוחה מהתפריט'); },
    }, 'חזרה לארוחה המתוכננת'));
  }
  return card;
}

const REMOVE_LABEL = { protein: 'בלי חלבון', carb: 'בלי פחמימה', fat: 'בלי שומן', veg: 'בלי ירקות', fruit: 'בלי פרי' };
const SIDE_NAME = { veg: 'הירקות', fruit: 'הפרי' };
const REMOVED_TEXT = { protein: 'החלבון הוסר', carb: 'הפחמימה הוסרה', fat: 'השומן הוסר' };
const BACK_TEXT = { protein: 'החלבון חזר לארוחה', carb: 'הפחמימה חזרה לארוחה', fat: 'השומן חזר לארוחה', veg: 'הירקות חזרו לארוחה', fruit: 'הפרי חזר לארוחה' };
const MACRO_NAME = { protein: 'חלבון', carb: 'פחמימות', fat: 'שומן' };

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
  const chips = h('div', { class: 'rm-chips', role: 'group', 'aria-label': 'להוריד מהארוחה' });
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
            ? 'אי אפשר להוריד את החלבון כאן — הארוחה הייתה נשארת רק עם שומן.'
            : 'אי אפשר להוריד את זה מהארוחה הזאת.');
          return;
        }
        await setOverride(day, meal.index, { removed: next });
        if (on) toast(BACK_TEXT[g]);
        else toast(`${meal.name} בלי ${MACRO_NAME[g] || { veg: 'ירקות', fruit: 'פרי' }[g]} — הקלוריות חולקו מחדש`);
      },
    }, on ? icon('check', 14) : null, REMOVE_LABEL[g]));
  }
  const wrap = h('div', { class: 'rm-bar' },
    h('div', { class: 'rm-title muted small' }, 'להוריד מהארוחה:'),
    chips);
  if (removed.length) {
    const macros = removed.filter((g) => MACRO_NAME[g]);
    const sides = removed.filter((g) => SIDE_NAME[g]).map((g) => SIDE_NAME[g]);
    const rest = ['protein', 'carb', 'fat'].filter((g) => meal.removable.includes(g) && !macros.includes(g)).map((g) => MACRO_NAME[g]);
    const to = rest.length > 1 ? `חולקו בין ה${rest[0]} ל${rest[1]}` : `עברו ל${rest[0]}`;
    const text = macros.length
      ? `${REMOVED_TEXT[macros[0]]}${sides.length ? ` וגם ${sides.join(' ו')}` : ''} — ${fmt(meal.freedKcal)} קק״ל ${to}, והארוחה נשארת על אותן קלוריות.`
      : `${sides.join(' ו')} ${sides.length > 1 || removed[0] === 'veg' ? 'הוסרו' : 'הוסר'} — שאר הארוחה הוגדלה לאותן קלוריות.`;
    wrap.appendChild(h('p', { class: 'rm-note small' }, icon('info', 16), h('span', null, text)));
  }
  return wrap;
}

export function openSwapSheet(item, meal, day, onAsk) {
  const SHOWN = 6;
  const res = alternatives(item, meal, state.profile.prefs, Infinity, { all: true });
  const keyName = { p: 'חלבון', c: 'פחמימות', f: 'שומן', kcal: 'קלוריות' }[res.matchedOn];
  const s = sheet(`${SWAP_LABEL[item.role]}: ${res.source.name}`, (close) => {
    const body = h('div', null,
      h('p', { class: 'muted small' },
        `במקום ${res.source.grams} ג׳ (${res.source.household}) — ${res.source.kcal} קק״ל. התחליפים מותאמים לאותה כמות ${keyName} ומסוננים לפי ההגבלות שלך.`));
    if (!res.options.length) {
      body.appendChild(h('p', { class: 'empty' }, 'אין תחליפים מתאימים במאגר עבור ההגבלות שלך. אפשר לשאול את העוזר.'));
    }
    const list = h('ul', { class: 'alt-list' });
    const row = (o) => h('li', { class: 'alt', 'data-food': o.foodId },
      h('div', { class: 'alt-text' },
        h('div', { class: 'alt-name' }, o.name),
        h('div', { class: 'alt-amt' }, h('b', { class: 'num' }, `${o.grams} ג׳`), ` · ${o.household}`),
        h('div', { class: 'muted small num' },
          `${o.kcal} קק״ל `, ltr(`(${o.dKcal > 0 ? '+' : ''}${o.dKcal})`), ` · ח ${fmt(o.p, 1)} · פ ${fmt(o.c, 1)} · ש ${fmt(o.f, 1)}`)),
      h('button', {
        class: 'btn btn-small btn-primary',
        onclick: async () => {
          await setOverride(day, meal.index, { swap: { slot: item.slot, foodId: o.foodId, grams: o.grams } });
          close();
          toast(`הוחלף ל${o.name}`);
        },
      }, 'החלף'));
    // Search: typing a name shows every matching food (all of the kind, not
    // just the first few); empty shows the usual short list.
    const search = h('input', { class: 'search', id: 'alt-search', type: 'search', placeholder: 'חיפוש מאכל…', autocomplete: 'off', 'aria-label': 'חיפוש מאכל' });
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
    }, `לראות את כל האפשרויות (${res.options.length})`);
    const draw = () => {
      clear(list);
      const q = normText(search.value);
      const names = (o) => normText(`${o.name} ${(FOOD_BY_ID[o.foodId] && FOOD_BY_ID[o.foodId].aliases || []).join(' ')}`);
      const hit = q ? res.options.filter((o) => names(o).includes(q)) : expanded ? res.options : res.options.slice(0, SHOWN);
      for (const o of hit) list.appendChild(row(o));
      if (!hit.length) list.appendChild(h('li', { class: 'empty' }, 'לא נמצא מאכל כזה בין התחליפים. נסו מילה אחרת.'));
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
          toast('אי אפשר להוציא גם את זה — צריך להשאיר לפחות 2 אפשרויות מכל סוג כדי שתמיד יהיה תחליף.');
          return;
        }
        await excludeFood(item.foodId);
        close();
        toast(`${res.source.name} הוצא מהתפריט לתמיד. אפשר להחזיר בפרופיל ← העדפות תזונה.`);
      },
    }, icon('close', 18), 'אני לא אוכל/ת את זה — להוציא מהתפריט'));
    if (onAsk) {
      body.appendChild(h('button', {
        class: 'btn btn-ghost btn-block',
        onclick: () => { close(); onAsk(item, meal, { ...res, options: res.options.slice(0, SHOWN) }); },
      }, icon('chat', 18), 'שאל את העוזר על תחליפים נוספים'));
    }
    return body;
  });
  return s;
}

// Weight + body-fat form with validation; used by the weekly gate and Profile.
// person(): { sex, age, height } for the body-fat estimator (optional).
export function metricsForm({ weight, bf, submitLabel = 'שמירה', onSubmit, previous, person }) {
  const wIn = h('input', { id: 'm-weight', type: 'text', inputmode: 'decimal', autocomplete: 'off', required: true, value: weight ?? '', 'aria-describedby': 'm-weight-err', placeholder: 'לדוגמה 72.5' });
  const bIn = h('input', { id: 'm-bf', type: 'text', inputmode: 'decimal', autocomplete: 'off', required: true, value: bf ?? '', 'aria-describedby': 'm-bf-err', placeholder: 'לדוגמה 18' });
  const wErr = h('div', { class: 'field-err', id: 'm-weight-err', role: 'alert' });
  const bErr = h('div', { class: 'field-err', id: 'm-bf-err', role: 'alert' });
  const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, submitLabel);
  const form = h('form', { class: 'form', novalidate: true },
    h('label', { class: 'field' }, h('span', null, 'משקל נוכחי (ק״ג)'), wIn, wErr),
    h('label', { class: 'field' }, h('span', null, 'אחוז שומן נוכחי (%)'), bIn, bErr,
      h('small', { class: 'muted' }, 'הערכה ממשקל חכם, קליפר או מדידה מקצועית. כדאי למדוד באותם תנאים בכל שבוע.')),
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
    }, icon('camera', 18), 'לא יודע/ת את אחוז השומן? הערכה מתמונות') : null,
    btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const w = parseNum(wIn.value);
    const b = parseNum(bIn.value);
    let ok = true;
    wErr.textContent = '';
    bErr.textContent = '';
    if (!(w >= 30 && w <= 300)) { wErr.textContent = 'יש להזין משקל בין 30 ל-300 ק״ג.'; ok = false; }
    if (!validBf(b)) { bErr.textContent = 'יש להזין אחוז שומן בין 3 ל-60.'; ok = false; }
    wIn.setAttribute('aria-invalid', wErr.textContent ? 'true' : 'false');
    bIn.setAttribute('aria-invalid', bErr.textContent ? 'true' : 'false');
    if (ok && previous && Math.abs(w - previous.weight) > previous.weight * 0.1) {
      if (!form.dataset.confirmJump) {
        form.dataset.confirmJump = '1';
        wErr.textContent = `שינוי של ${Math.abs(w - previous.weight).toFixed(1)} ק״ג מהמדידה הקודמת. אם זה נכון — לחצו שוב לאישור.`;
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
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'הפחת', onclick: () => set(v - 1) }, icon('minus')),
    out,
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'הוסף', onclick: () => set(v + 1) }, icon('plus')));
}

export function assessmentBox(a, onApply) {
  if (!a || (a.level === 'ok' && !a.messages.length)) {
    return h('div', { class: 'notice ok' }, icon('check', 18), h('span', null, 'היעד ריאלי ובטוח לתקופה שנבחרה.'));
  }
  const box = h('div', { class: `notice ${a.level}`, role: 'alert' },
    h('div', null, ...a.messages.map((m) => h('p', null, m))));
  if (a.suggestion && onApply) {
    const s = a.suggestion;
    const opts = h('div', { class: 'row gap wrap' });
    if (s.weeks) opts.appendChild(h('button', { type: 'button', class: 'btn btn-small', onclick: () => onApply({ weeks: s.weeks }) }, `הארך ל-${s.weeks} שבועות`));
    if (s.targetWeight) opts.appendChild(h('button', { type: 'button', class: 'btn btn-small', onclick: () => onApply({ targetWeight: s.targetWeight }) }, `יעד ${s.targetWeight} ק״ג`));
    if (s.targetBf) opts.appendChild(h('button', { type: 'button', class: 'btn btn-small', onclick: () => onApply({ targetBf: s.targetBf }) }, `יעד שומן ${s.targetBf}%`));
    box.appendChild(h('div', null, h('p', { class: 'small' }, 'הצעה ריאלית:'), opts));
  }
  return box;
}

export function disclaimer() {
  return h('p', { class: 'disclaimer' }, icon('info', 16),
    'המידע באפליקציה הוא כללי ואינו מהווה ייעוץ רפואי. במצב רפואי, הריון, הפרעות אכילה או נטילת תרופות — יש להתייעץ עם רופא/ה או דיאטן/ית קליני/ת.');
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
