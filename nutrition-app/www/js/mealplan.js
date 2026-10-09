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

function poolFor(slot, type, allowed) {
  let roles = [slot];
  if (slot === 'carb' && type === 's') roles = ['carb', 'fruit'];
  const byMeal = allowed.filter((f) => roles.includes(f.role) && f.meals.includes(type));
  if (byMeal.length) return byMeal;
  // Restrictions emptied the meal-appropriate list: fall back to any allowed food in the role.
  return allowed.filter((f) => roles.includes(f.role));
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

function descend(items, target, iterations = 80) {
  for (let i = 0; i < iterations; i++) {
    for (const it of items) {
      if (it.fixed) continue;
      const food = FOOD_BY_ID[it.foodId];
      const t = totals(items);
      let num = 0;
      let den = 0;
      for (const k of KEYS) {
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

export function solvePortions(items, target) {
  for (const it of items) {
    const food = FOOD_BY_ID[it.foodId];
    if (it.fixed) continue;
    it.lo = it.role === 'protein' ? food.min : 0;
    it.grams = it.grams || (food.min + food.max) / 3;
  }
  descend(items, target);

  // Drop carbs/fats the meal doesn't need (e.g. salmon already brings the fat).
  let kept = items.filter((it) => it.fixed || it.role === 'protein' || it.grams >= FOOD_BY_ID[it.foodId].min * 0.5);
  for (const it of kept) {
    if (!it.fixed) it.lo = FOOD_BY_ID[it.foodId].min;
  }
  descend(kept, target);

  // Whole eggs, whole slices: round, freeze, and re-solve the rest around them.
  for (const it of kept) {
    const food = FOOD_BY_ID[it.foodId];
    if (!it.fixed && food.discrete) {
      it.grams = roundGrams(food, it.grams);
      it.fixed = true;
    }
  }
  descend(kept, target);
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

export function buildMeal(type, target, allowed, rand, usedProteins, everything = allowed) {
  const chosen = [];
  for (const slot of SLOTS[type]) {
    let pool = poolFor(slot, type, allowed).filter((f) => kosherCompatible(f, chosen.map((c) => c.food)));
    if (slot === 'protein') {
      // Prefer proteins that can carry this meal's protein on their own.
      const able = pool.filter((f) => capacity(f) >= target.p * 0.85);
      if (able.length) pool = able;
    }
    const avoid = slot === 'protein' ? usedProteins : new Set(chosen.map((c) => c.food.id));
    const food = pick(pool, rand, avoid);
    if (!food) continue;
    if (slot === 'protein') usedProteins.add(food.id);
    chosen.push({ slot, food });
  }
  const toItem = ({ slot, food }) => ({
    slot,
    role: food.role,
    foodId: food.id,
    grams: food.portion || 0,
    fixed: food.role === 'veg',
  });
  let items = solvePortions(chosen.map(toItem), target);

  // Still short on protein (e.g. a vegan meal built on lentils)? Add the
  // densest compatible second protein and solve again.
  const got = totals(items).p;
  if (got < target.p * 0.85) {
    const inMeal = chosen.map((c) => c.food);
    const candidates = (list) => list
      .filter((f) => f.role === 'protein' && !inMeal.some((x) => x.id === f.id) && kosherCompatible(f, inMeal))
      .sort((a, b) => fitScore(b, type) - fitScore(a, type));
    // Prefer this week's foods; reach outside only if none fit.
    const extra = candidates(allowed)[0] || candidates(everything)[0];
    if (extra) {
      chosen.push({ slot: 'protein2', food: extra });
      items = solvePortions(chosen.map(toItem), target);
    }
  }
  return items;
}

// The foods of one menu week. Picking each day from the whole database makes
// a shopping list of ~55 products; a weekly set keeps the cart realistic while
// meals still vary day to day, and the set rotates every week.
const POOL_SIZE = { protein: 5, carb: 4, fat: 3, veg: 4, fruit: 3 };

export function weeklyPool(allowed, types, poolKey, userSeed = 0) {
  const rand = rng(hashStr(`pool|${poolKey}|${userSeed}`));
  const shuffled = allowed.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const picked = new Set();
  for (const [role, n] of Object.entries(POOL_SIZE)) {
    shuffled.filter((f) => f.role === role).slice(0, n).forEach((f) => picked.add(f.id));
  }
  // Every slot of every meal type needs at least two choices in the pool.
  for (const type of new Set(types)) {
    for (const slot of SLOTS[type]) {
      const roles = slot === 'carb' && type === 's' ? ['carb', 'fruit'] : [slot];
      const fits = (f) => roles.includes(f.role) && f.meals.includes(type);
      let have = shuffled.filter((f) => picked.has(f.id) && fits(f)).length;
      for (const f of shuffled) {
        if (have >= 2) break;
        if (!picked.has(f.id) && fits(f)) { picked.add(f.id); have++; }
      }
    }
  }
  return allowed.filter((f) => picked.has(f.id));
}

// overrides: { [mealIndex]: { reseed?: number, swaps?: { [slot]: { foodId, grams } } } }
// poolKey: the menu-week number; omit it to draw from every allowed food.
export function generateDay(dateKey, targets, prefs, overrides = {}, userSeed = 0, poolKey = null) {
  const everything = allowedFoods(prefs);
  const tmpl = mealTemplate(prefs.mealsPerDay);
  const allowed = poolKey === null ? everything : weeklyPool(everything, tmpl.map((m) => m.type), poolKey, userSeed);
  const used = new Set();
  return tmpl.map((m, idx) => {
    const ov = overrides[idx] || {};
    const rand = rng(hashStr(`${dateKey}|${idx}|${ov.reseed || 0}|${userSeed}`));
    const target = {
      kcal: targets.calories * m.share,
      p: targets.protein * m.share,
      c: targets.carbs * m.share,
      f: targets.fat * m.share,
    };
    let items = buildMeal(m.type, target, allowed, rand, used, everything);
    if (ov.swaps) {
      for (const [slot, sw] of Object.entries(ov.swaps)) {
        const food = FOOD_BY_ID[sw.foodId];
        // A swap to a food the user has since excluded is dropped.
        if (!food || !isAllowed(food, prefs)) continue;
        const replacement = { slot, role: food.role, foodId: food.id, grams: sw.grams };
        const at = items.findIndex((i) => i.slot === slot);
        if (at >= 0) items[at] = replacement;
        else items.push(replacement);
      }
    }
    items = items.map(itemWithMacros);
    const t = totals(items);
    return {
      index: idx,
      type: m.type,
      name: m.name,
      target: { kcal: Math.round(target.kcal), p: Math.round(target.p), c: Math.round(target.c), f: Math.round(target.f) },
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
