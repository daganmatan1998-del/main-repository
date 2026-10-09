// Local substitution engine: "replace 150 g rice with ..." computed on-device.
// Each alternative is scaled to deliver the same amount of the macro the item is
// there for (carbs for a carb, protein for a protein, fat for a fat), then ranked
// by how close it also stays on calories and the other two macros.
//
// The assistant receives these exact candidates as context, so its numbers and
// the app's numbers agree, and it works with no network at all.

import { FOOD_BY_ID, allowedFoods, kosherCompatible, macrosFor, household } from './foods.js';

const KEY = { protein: 'p', carb: 'c', fat: 'f', fruit: 'c', veg: 'kcal' };
const MIN_DENSITY = { p: 6, c: 8, f: 8, kcal: 10 };

function roundFor(food, g) {
  if (food.discrete) {
    const u = food.units[0];
    const stepG = u.g * (u.step || 1);
    return Math.max(stepG, Math.round(g / stepG) * stepG);
  }
  return g < 40 ? Math.max(1, Math.round(g)) : Math.round(g / 5) * 5;
}

export function alternatives(item, meal, prefs, limit = 5) {
  const src = FOOD_BY_ID[item.foodId];
  const key = KEY[src.role];
  const srcM = macrosFor(src, item.grams);
  const amount = srcM[key];
  const mealFoods = (meal ? meal.items : [])
    .filter((i) => i.slot !== item.slot)
    .map((i) => FOOD_BY_ID[i.foodId]);

  // First pass: realistic plates only. If that leaves nothing (tight
  // restrictions), relax the density and portion limits so the user always
  // gets a substitute; the portion is then capped at the food's maximum.
  const build = (strict) => {
    const out = [];
    for (const cand of allowedFoods(prefs)) {
      if (cand.id === src.id || cand.role !== src.role) continue;
      if (!kosherCompatible(cand, mealFoods)) continue;
      if (cand[key] <= 0 || (strict && cand[key] < MIN_DENSITY[key])) continue;
      let raw = amount / (cand[key] / 100);
      if (strict && raw > cand.max * 1.6) continue; // would be an unrealistic plate
      if (!strict) raw = Math.min(raw, cand.max * 1.6);
      const grams = roundFor(cand, raw);
      const m = macrosFor(cand, grams);
      const others = ['p', 'c', 'f'].filter((k) => k !== key);
      const kcalFactor = { p: 4, c: 4, f: 9 };
      const otherDiff = others.reduce((sum, k) => sum + Math.abs(m[k] - srcM[k]) * kcalFactor[k], 0);
      const base = Math.max(srcM.kcal, 1);
      const fits = meal && cand.meals.includes(meal.type) ? 0 : 0.25;
      const score = Math.abs(m.kcal - srcM.kcal) / base + 0.5 * otherDiff / base + fits;
      out.push({
        foodId: cand.id,
        name: cand.name,
        grams,
        household: household(cand, grams),
        kcal: Math.round(m.kcal),
        p: Math.round(m.p * 10) / 10,
        c: Math.round(m.c * 10) / 10,
        f: Math.round(m.f * 10) / 10,
        dKcal: Math.round(m.kcal - srcM.kcal),
        score,
      });
    }
    return out;
  };
  let options = build(true);
  if (!options.length) options = build(false);
  options.sort((a, b) => a.score - b.score);
  return {
    source: {
      foodId: src.id,
      name: src.name,
      role: src.role,
      grams: item.grams,
      household: household(src, item.grams),
      kcal: Math.round(srcM.kcal),
      p: Math.round(srcM.p * 10) / 10,
      c: Math.round(srcM.c * 10) / 10,
      f: Math.round(srcM.f * 10) / 10,
    },
    matchedOn: key,
    options: options.slice(0, limit),
  };
}
