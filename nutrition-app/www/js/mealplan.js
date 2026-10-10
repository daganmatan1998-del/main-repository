// Daily meal-plan generator.
//
// Each meal gets a share of the day's macros. Foods are picked per slot
// (protein / carb / fat / veg) from the foods the user is allowed to eat, then
// portion sizes are solved so the meal's protein, carbs and fat land on target
// together (bounded coordinate descent, weighted by kcal so a gram of fat
// counts 9/4 of a gram of carbs). Discrete foods (eggs, bread slices) are
// rounded to whole units and the rest re-solved around them.

import { allowedFoods, kosherCompatible, macrosFor, FOOD_BY_ID, isAllowed } from './foods.js';
import { rng, hashStr, clamp } from './util.js';

const MEAL_NAMES = {
  b: 'ארוחת בוקר',
  l: 'ארוחת צהריים',
  d: 'ארוחת ערב',
};

const TEMPLATES = {
  3: [['b', 0.28], ['l', 0.4], ['d', 0.32]],
  4: [['b', 0.25], ['l', 0.35], ['s', 0.15, 'ארוחת ביניים'], ['d', 0.25]],
  5: [['b', 0.22], ['s', 0.12, 'ביניים בוקר'], ['l', 0.3], ['s', 0.12, 'ביניים אחר הצהריים'], ['d', 0.24]],
  6: [['b', 0.2], ['s', 0.1, 'ביניים בוקר'], ['l', 0.27], ['s', 0.11, 'ביניים אחר הצהריים'], ['d', 0.22], ['s', 0.1, 'ארוחת לילה']],
};

const SLOTS = {
  b: ['protein', 'carb', 'fat', 'veg'],
  l: ['protein', 'carb', 'fat', 'veg'],
  d: ['protein', 'carb', 'fat', 'veg'],
  s: ['protein', 'carb', 'fat'],
};

// Keto drops the carb slot (vegetables carry the few carbs); carnivore keeps
// only animal protein and fat.
const DIET_SLOTS = {
  keto: {
    b: ['protein', 'fat', 'fat2', 'veg'],
    l: ['protein', 'fat', 'fat2', 'veg'],
    d: ['protein', 'fat', 'fat2', 'veg'],
    s: ['protein', 'fat'],
  },
  carnivore: {
    b: ['protein', 'fat', 'fat2'],
    l: ['protein', 'fat', 'fat2'],
    d: ['protein', 'fat', 'fat2'],
    s: ['protein', 'fat'],
  },
};

export function slotsFor(diet) {
  return DIET_SLOTS[diet] || SLOTS;
}

export function mealTemplate(count) {
  const t = TEMPLATES[clamp(Number(count) || 4, 3, 6)];
  return t.map(([type, share, name]) => ({ type, share, name: name || MEAL_NAMES[type] }));
}

function pick(list, rand, avoid) {
  if (!list.length) return null;
  const fresh = list.filter((f) => !avoid.has(f.id));
  const pool = fresh.length ? fresh : list;
  return pool[Math.floor(rand() * pool.length)];
}

// Slot names are unique per meal (overrides are keyed by them); 'fat2' is a
// second fat slot used by the high-fat diets, 'protein2' a protein top-up, and
// 'carb2' / 'fat3' fill a meal the user took a food group out of.
const slotRole = (slot) => slot.replace(/\d+$/, '');

function poolFor(slot, type, allowed) {
  let roles = [slotRole(slot)];
  if (slot === 'carb' && type === 's') roles = ['carb', 'fruit'];
  const byMeal = allowed.filter((f) => roles.includes(f.role) && f.meals.includes(type));
  if (byMeal.length >= 3) return byMeal;
  // Restrictions left too few foods that usually belong in this meal: add the
  // rest of the category after them, so a week can still vary.
  return byMeal.concat(allowed.filter((f) => roles.includes(f.role) && !f.meals.includes(type)));
}

const W = { p: 16 * 1.5, c: 16, f: 81 };
const KEYS = ['p', 'c', 'f'];

function totals(items) {
  const t = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const it of items) {
    const m = macrosFor(FOOD_BY_ID[it.foodId], it.grams);
    t.kcal += m.kcal; t.p += m.p; t.c += m.c; t.f += m.f;
  }
  return t;
}

function descend(items, target, iterations = 80, keys = KEYS) {
  for (let i = 0; i < iterations; i++) {
    for (const it of items) {
      if (it.fixed) continue;
      const food = FOOD_BY_ID[it.foodId];
      const t = totals(items);
      let num = 0;
      let den = 0;
      for (const k of keys) {
        const d = food[k] / 100;
        num += W[k] * d * (target[k] - t[k]);
        den += W[k] * d * d;
      }
      if (den <= 0) continue;
      it.grams = clamp(it.grams + num / den, it.lo, food.max);
    }
  }
}

function roundGrams(food, g) {
  if (food.discrete) {
    const u = food.units[0];
    const stepG = u.g * (u.step || 1);
    return Math.max(stepG, Math.round(g / stepG) * stepG);
  }
  return g < 40 ? Math.max(1, Math.round(g)) : Math.round(g / 5) * 5;
}

// keys: the macros to aim at. A meal the user took a macro group out of aims
// only at the remaining ones (whatever the other foods incidentally bring of
// the removed macro isn't chased down to zero).
export function solvePortions(items, target, keys = KEYS) {
  for (const it of items) {
    const food = FOOD_BY_ID[it.foodId];
    if (it.fixed) continue;
    it.lo = it.role === 'protein' ? food.min : 0;
    it.grams = it.grams || (food.min + food.max) / 3;
  }
  descend(items, target, 80, keys);

  // Drop carbs/fats the meal doesn't need (e.g. salmon already brings the fat).
  let kept = items.filter((it) => it.fixed || it.role === 'protein' || it.grams >= FOOD_BY_ID[it.foodId].min * 0.5);
  for (const it of kept) {
    if (!it.fixed) it.lo = FOOD_BY_ID[it.foodId].min;
  }
  descend(kept, target, 80, keys);

  // Whole eggs, whole slices: round, freeze, and re-solve the rest around them.
  for (const it of kept) {
    const food = FOOD_BY_ID[it.foodId];
    if (!it.fixed && food.discrete) {
      it.grams = roundGrams(food, it.grams);
      it.fixed = true;
    }
  }
  descend(kept, target, 80, keys);
  for (const it of kept) it.grams = roundGrams(FOOD_BY_ID[it.foodId], it.grams);
  return kept.map(({ lo, fixed, ...rest }) => rest);
}

function itemWithMacros(it) {
  const m = macrosFor(FOOD_BY_ID[it.foodId], it.grams);
  return { ...it, kcal: Math.round(m.kcal), p: round1(m.p), c: round1(m.c), f: round1(m.f) };
}

const round1 = (n) => Math.round(n * 10) / 10;

// Protein a food can deliver in one sensible serving.
const capacity = (f) => f.max * f.p / 100;
// Protein density, with a small bonus for foods that belong in this meal.
const fitScore = (f, type) => f.p / f.kcal + (f.meals.includes(type) ? 0.03 : 0);

// Picks the food for one slot.
//  - Day mode (no week plan): random, avoiding what the day already uses.
//  - Week mode: every meal slot walks its own shuffled list of options, one
//    step per day, so each day of the week shows different meals. Collisions
//    within a day (same protein at lunch and dinner) step on to the next option.
function chooser({ rand, week, dayIndex, mealIdx, reseed, userSeed, roleFoods, weekPlan }) {
  if (week === undefined || week === null) {
    const choose = (slot, eligible, avoid) => pick(eligible, rand, avoid);
    choose.any = choose;
    return choose;
  }
  const choose = (slot, eligible, avoid, all) => {
    if (!eligible.length) return null;
    if (slot === 'protein') {
      // "Another meal" steps along this meal's rotation from the planned main.
      const planned = weekPlan.days[dayIndex][mealIdx];
      const { order } = weekPlan.orders[mealIdx];
      if (!reseed && planned) return planned;
      const from = Math.max(0, order.findIndex((f) => f.id === (planned && planned.id)));
      for (let k = 1; k <= order.length; k++) {
        const f = order[(from + reseed * k) % order.length] || order[(from + k) % order.length];
        if (f && !avoid.has(f.id)) return f;
      }
      return planned || pick(eligible, rand, avoid);
    }
    // One shuffled order per role and meal group (lunch + dinner share one),
    // built from the whole category so it is identical every day. Day d takes
    // option d; the second meal of a group starts half-way round, so lunch and
    // dinner never land on the same food and neither repeats within the week.
    const role = slotRole(slot);
    let order = shuffled(roleFoods(role), `week|${week}|${role}|${userSeed}`);
    const forMeal = new Set(all.map((f) => f.id));
    order = order.filter((f) => forMeal.has(f.id));
    // Sides rotate within a small set so the shopping list stays sane.
    const cycle = SIDE_CYCLE[role];
    if (cycle && order.length > cycle) order = order.slice(0, cycle);
    if (!order.length) return pick(eligible, rand, avoid);
    const start = (dayIndex + mealIdx + reseed) % order.length;
    const ok = new Set(eligible.map((f) => f.id));
    let fallback = null;
    for (let k = 0; k < order.length; k++) {
      const f = order[(start + k) % order.length];
      if (!ok.has(f.id)) continue;
      if (!avoid.has(f.id)) return f;
      fallback = fallback || f;
    }
    // Nothing in the rotation fits this meal (kosher, capacity): any eligible food.
    return fallback || pick(eligible, rand, avoid);
  };
  // A seeded draw outside the weekly rotation (a main that doesn't suit a removal).
  choose.any = (slot, eligible, avoid) => pick(eligible, rand, avoid);
  return choose;
}

// Proteins a meal may be built on: ones that can carry most of the meal's
// protein (a second protein tops up), with a loose bar so a week still has
// enough different options.
function proteinPool(type, target, allowed) {
  const pool = poolFor('protein', type, allowed);
  const strong = (f) => capacity(f) >= target.p * 0.6;
  let out = pool.filter(strong);
  if (out.length < 3) out = pool;
  // Fewer than a week of options for this meal: borrow suitable proteins that
  // usually belong to other meals (cottage at lunch), so days don't repeat.
  if (out.length < 7) {
    const have = new Set(out.map((f) => f.id));
    out = out.concat(allowed.filter((f) => f.role === 'protein' && !have.has(f.id) && strong(f)));
  }
  return out;
}

function shuffled(list, seedText) {
  const out = list.slice().sort((x, y) => (x.id < y.id ? -1 : 1));
  const r = rng(hashStr(seedText));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// The main protein of every meal for all 7 days of a menu week, planned in
// one pass: no food twice in the same day, and each meal shows a different
// main every day of the week whenever there are enough options.
function planWeekMains({ tmpl, mealTargets, allowed, week, userSeed, groups }) {
  const orders = tmpl.map((m, idx) => {
    const group = groups[idx];
    const order = shuffled(proteinPool(m.type, mealTargets[idx], allowed), `main|${week}|${group}|${userSeed}`);
    const pos = groups.slice(0, idx).filter((g) => g === group).length;
    const size = groups.filter((g) => g === group).length;
    return { order, offset: pos * Math.floor(order.length / size) };
  });
  const usedByMeal = tmpl.map(() => new Set());
  const days = [];
  for (let d = 0; d < 7; d++) {
    const today = new Set();
    const picks = [];
    orders.forEach(({ order, offset }, idx) => {
      if (!order.length) { picks.push(null); return; }
      const start = (d + offset) % order.length;
      const at = (k) => order[(start + k) % order.length];
      let food = null;
      for (let k = 0; k < order.length && !food; k++) {
        const f = at(k);
        if (!today.has(f.id) && !usedByMeal[idx].has(f.id)) food = f;
      }
      for (let k = 0; k < order.length && !food; k++) {
        const f = at(k);
        if (!today.has(f.id)) food = f;
      }
      food = food || at(0);
      today.add(food.id);
      usedByMeal[idx].add(food.id);
      picks.push(food);
    });
    days.push(picks);
  }
  return { days, orders };
}

// How many different sides each week rotates through.
const SIDE_CYCLE = { carb: 5, fat: 3, veg: 4, fruit: 3 };

// The food groups a user can take out of a meal, and the slots each covers.
export const GROUPS = ['protein', 'carb', 'fat', 'veg'];
export const slotGroup = (slot) => slot.replace(/\d+$/, '');
const GROUP_MACRO = { protein: 'p', carb: 'c', fat: 'f' };
const KCAL_PER_G = { p: 4, c: 4, f: 9 };
const kcalOf = (t, keys) => keys.reduce((s, k) => s + t[k] * KCAL_PER_G[k], 0);

// The meal's macro target with some groups taken out: the calories the removed
// macros carried are shared among the remaining ones in proportion to their
// own calories, so the meal keeps its calories (e.g. no carbs at lunch: the
// carb calories go to protein and fat, more to whichever already had more).
export function retarget(target, removed = []) {
  const gone = removed.map((g) => GROUP_MACRO[g]).filter(Boolean);
  if (!gone.length) return { ...target };
  const rest = KEYS.filter((k) => !gone.includes(k));
  const freed = kcalOf(target, gone);
  const restKcal = kcalOf(target, rest);
  const out = { ...target };
  for (const k of gone) out[k] = 0;
  for (const k of rest) {
    const share = restKcal > 0 ? (target[k] * KCAL_PER_G[k]) / restKcal : 1 / rest.length;
    out[k] = target[k] + (freed * share) / KCAL_PER_G[k];
  }
  return out;
}

const keysFor = (removed) => KEYS.filter((k) => !removed.some((g) => GROUP_MACRO[g] === k));

// Portions for a meal with some groups taken out: aim at the retargeted
// macros only, then correct for what the remaining foods still bring of the
// removed macro (fat in chicken, carbs in yogurt) so the meal lands on its
// calories rather than above them.
function solveWithout(items, target, removed) {
  const keys = keysFor(removed);
  const aim = retarget(target, removed);
  const fresh = () => items.map((it) => ({ ...it }));
  let out = solvePortions(fresh(), aim, keys);
  if (keys.length === KEYS.length) return out;
  const incidental = kcalOf(totals(out), KEYS.filter((k) => !keys.includes(k)));
  const restKcal = kcalOf(aim, keys);
  if (incidental > 0 && restKcal > 0) {
    const scale = Math.max(0.85, (restKcal - incidental) / restKcal);
    const aim2 = { ...aim };
    for (const k of keys) aim2[k] = aim[k] * scale;
    out = solvePortions(fresh(), aim2, keys);
  }
  return out;
}

export function buildMeal(type, target, allowed, choose, usedToday, slots = SLOTS, removed = []) {
  const chosen = [];
  // With a macro removed, prefer foods that aren't mostly that macro
  // (no chickpeas as the protein of a carb-free meal, no salmon in a fat-free one).
  const gone = removed.map((g) => GROUP_MACRO[g]).filter(Boolean);
  const suits = (f) => gone.every((k) => (f[k] * KCAL_PER_G[k]) / f.kcal <= 0.45);
  const suited = (list) => {
    const ok = list.filter(suits);
    return ok.length ? ok : list;
  };
  for (const slot of slots[type]) {
    if (removed.includes(slotGroup(slot))) continue;
    const all = poolFor(slot, type, allowed);
    let pool = all.filter((f) => kosherCompatible(f, chosen.map((c) => c.food)));
    if (slot === 'protein') pool = proteinPool(type, target, allowed);
    if (gone.length) pool = suited(pool);
    const avoid = new Set([...usedToday, ...chosen.map((c) => c.food.id)]);
    let food = choose(slot, pool, avoid, all);
    if (food && gone.length && !pool.includes(food) && choose.any) food = choose.any(slot, pool, avoid);
    // Never the same food twice in one meal (olive oil as both fats).
    if (food && chosen.some((c) => c.food.id === food.id)) {
      const rest = pool.filter((f) => !chosen.some((c) => c.food.id === f.id));
      food = rest.length ? choose.any(slot, rest, avoid) : null;
    }
    if (!food) continue;
    usedToday.add(food.id);
    chosen.push({ slot, food });
  }
  const toItem = ({ slot, food }) => ({
    slot,
    role: food.role,
    foodId: food.id,
    grams: food.portion || 0,
    fixed: food.role === 'veg',
  });
  const keys = keysFor(removed);
  const aim = retarget(target, removed);
  const solve = () => solveWithout(chosen.map(toItem), target, removed);
  let items = solve();

  // Still short on protein (e.g. a vegan meal built on lentils)? Add the
  // densest compatible second protein and solve again.
  const got = totals(items).p;
  if (!removed.includes('protein') && got < aim.p * 0.85) {
    const inMeal = chosen.map((c) => c.food);
    const extra = suited(allowed
      .filter((f) => f.role === 'protein' && !inMeal.some((x) => x.id === f.id) && kosherCompatible(f, inMeal)))
      .sort((a, b) => fitScore(b, type) - fitScore(a, type))[0];
    if (extra) {
      chosen.push({ slot: 'protein2', food: extra });
      items = solve();
    }
  }

  // With a group taken out, the remaining foods can hit their sensible maximum
  // before the meal reaches its calories. Add a second food from the remaining
  // group that is furthest behind (a second carb, another fat) and solve again.
  for (let round = 0; removed.length && round < 3; round++) {
    const t = totals(items);
    if (t.kcal >= target.kcal * 0.93) break;
    const gaps = keys
      .map((k) => ({ k, gap: (aim[k] - t[k]) * KCAL_PER_G[k] }))
      .filter((g) => g.gap > 0)
      .sort((a, b) => b.gap - a.gap);
    let added = false;
    for (const { k } of gaps) {
      const group = Object.keys(GROUP_MACRO).find((g) => GROUP_MACRO[g] === k);
      const inMeal = chosen.map((c) => c.food);
      const dense = (f) => f[k] / f.kcal + (f.meals.includes(type) ? 0.03 : 0);
      const extra = suited(poolFor(group, type, allowed)
        .filter((f) => !inMeal.some((x) => x.id === f.id) && kosherCompatible(f, inMeal)))
        .sort((a, b) => dense(b) - dense(a) || (a.id < b.id ? -1 : 1))[0];
      if (!extra) continue;
      let n = 2;
      while (chosen.some((c) => c.slot === group + n)) n++;
      chosen.push({ slot: group + n, food: extra });
      added = true;
      break;
    }
    if (!added) break;
    items = solve();
  }
  return items;
}

// The groups that can be taken out of a meal built from these slots.
export function removableGroups(mealSlots) {
  return GROUPS.filter((g) => mealSlots.some((s) => slotGroup(s) === g));
}

// Which of the requested removals apply. Vegetables can always go. Of protein,
// carbs and fat only one goes at a time, and never so that fat alone is left:
// a meal that is all oil and nuts isn't a meal. Kept in request order so the
// latest choice wins.
export function validRemoval(offered, requested = []) {
  const out = [];
  for (const g of requested || []) {
    if (!offered.includes(g) || out.includes(g)) continue;
    if (g !== 'veg') {
      const macros = out.filter((x) => x !== 'veg');
      if (macros.length) continue;
      const left = offered.filter((x) => x !== 'veg' && x !== g);
      if (!left.includes('protein') && !left.includes('carb')) continue;
    }
    out.push(g);
  }
  return out;
}

// overrides: { [mealIndex]: { reseed?: number, swaps?: { [slot]: { foodId, grams } }, removed?: [group] } }
// plan: { week, dayIndex } — the menu week and the day within it (0–6). With it,
// the whole week is planned together so no two days look alike; without it,
// each day is drawn on its own.
export function generateDay(dateKey, targets, prefs, overrides = {}, userSeed = 0, plan = null) {
  const allowed = allowedFoods(prefs);
  const tmpl = mealTemplate(prefs.mealsPerDay);
  const slots = slotsFor(prefs.diet);
  const used = new Set();
  // Lunch and dinner form one group, snacks another; each meal's position in
  // its group sets where it starts in the weekly rotation.
  const groupOf = (type) => (type === 'l' || type === 'd' ? 'main' : type);
  const groups = tmpl.map((m) => groupOf(m.type));
  const roleFoods = (role) => allowed.filter((f) => f.role === role);
  const mealTargets = tmpl.map((m) => ({
    kcal: targets.calories * m.share,
    p: targets.protein * m.share,
    c: targets.carbs * m.share,
    f: targets.fat * m.share,
  }));
  const weekPlan = plan ? planWeekMains({ tmpl, mealTargets, allowed, week: plan.week, userSeed, groups }) : null;
  return tmpl.map((m, idx) => {
    const ov = overrides[idx] || {};
    const choose = chooser({
      weekPlan,
      roleFoods,
      rand: rng(hashStr(`${dateKey}|${idx}|${ov.reseed || 0}|${userSeed}`)),
      week: plan ? plan.week : null,
      dayIndex: plan ? plan.dayIndex : 0,
      mealIdx: idx,
      reseed: ov.reseed || 0,
      userSeed,
    });
    const target = mealTargets[idx];
    const offered = removableGroups(slots[m.type]);
    const removed = validRemoval(offered, ov.removed);
    let items = buildMeal(m.type, target, allowed, choose, used, slots, removed);
    let swapped = false;
    if (ov.swaps) {
      for (const [slot, sw] of Object.entries(ov.swaps)) {
        if (removed.includes(slotGroup(slot))) continue;
        const food = FOOD_BY_ID[sw.foodId];
        // A swap to a food the user has since excluded is dropped.
        if (!food || !isAllowed(food, prefs)) continue;
        const replacement = { slot, role: food.role, foodId: food.id, grams: sw.grams };
        const at = items.findIndex((i) => i.slot === slot);
        if (at >= 0) items[at] = replacement;
        else items.push(replacement);
        swapped = true;
      }
    }
    // A swap's grams were fitted to the full meal; with a group taken out,
    // keep the swapped foods but fit the portions again.
    if (swapped && removed.length) {
      items = solveWithout(items.map(({ slot, role, foodId, grams }) => ({ slot, role, foodId, grams: role === 'veg' ? grams : 0, fixed: role === 'veg' })), target, removed);
    }
    items = items.map(itemWithMacros);
    const t = totals(items);
    const aim = retarget(target, removed);
    return {
      index: idx,
      type: m.type,
      name: m.name,
      removable: offered,
      removed,
      // Calories the removed macros carried, now shared among the others.
      freedKcal: Math.round(kcalOf(target, removed.map((g) => GROUP_MACRO[g]).filter(Boolean))),
      target: { kcal: Math.round(target.kcal), p: Math.round(aim.p), c: Math.round(aim.c), f: Math.round(aim.f) },
      items,
      totals: { kcal: Math.round(t.kcal), p: round1(t.p), c: round1(t.c), f: round1(t.f) },
    };
  });
}

export function dayTotals(meals, onlyIdx) {
  const t = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const m of meals) {
    if (onlyIdx && !onlyIdx.has(m.index)) continue;
    t.kcal += m.totals.kcal; t.p += m.totals.p; t.c += m.totals.c; t.f += m.totals.f;
  }
  return t;
}
