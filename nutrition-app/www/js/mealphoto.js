// Calorie camera: the logic between Claude's photo estimate and the meal log.
// Pure functions (no DOM), unit-tested directly.
//
// Every item carries its values per gram, so changing the grams rescales it.
// An item the app knows (foodId) is computed from the app's own food table,
// so a photo of the planned chicken counts exactly like the planned chicken;
// anything else keeps the per-gram values Claude estimated.

import { FOOD_BY_ID, FOODS } from './foods.js';

const r1 = (n) => Math.round(n * 10) / 10;

function perGramOf(foodId) {
  const f = FOOD_BY_ID[foodId];
  return f ? { kcal: f.kcal / 100, p: f.p / 100, c: f.c / 100, f: f.f / 100 } : null;
}

// Sets grams and recomputes kcal and macros from the per-gram values.
export function withGrams(item, grams) {
  const g = Math.max(0, Math.round(Number(grams) || 0));
  const per = item.per;
  return { ...item, grams: g, kcal: Math.round(per.kcal * g), p: r1(per.p * g), c: r1(per.c * g), f: r1(per.f * g) };
}

// One item as Claude returned it -> an editable item.
export function fromEstimate(i) {
  const known = perGramOf(i.foodId);
  const g = Math.max(1, i.grams);
  const per = known || { kcal: i.kcal / g, p: i.p / g, c: i.c / g, f: i.f / g };
  return withGrams({
    name: known ? FOOD_BY_ID[i.foodId].name : i.name,
    seen: i.name,
    foodId: known ? i.foodId : '',
    confidence: i.confidence || 'medium',
    per,
  }, i.grams);
}

// A food from the app's table (the user picked it by name).
export function fromFood(foodId, grams) {
  return withGrams({ name: FOOD_BY_ID[foodId].name, seen: '', foodId, confidence: 'high', per: perGramOf(foodId) }, grams);
}

// A food the app doesn't know, entered by the user: kcal per 100 g, macros unknown.
export function custom(name, grams, kcalPer100) {
  const k = Math.max(0, Number(kcalPer100) || 0) / 100;
  return withGrams({ name, seen: '', foodId: '', confidence: 'high', per: { kcal: k, p: 0, c: 0, f: 0 }, custom: true }, grams);
}

// Renaming an item: to one of the app's foods (exact name) switches it to
// that food's values; any other name keeps the values it had.
export function rename(item, name) {
  const n = String(name || '').trim();
  const food = FOODS.find((f) => f.name === n);
  if (food) return withGrams({ ...item, name: food.name, foodId: food.id, per: perGramOf(food.id) }, item.grams);
  return { ...item, name: n || item.name, foodId: n === item.name ? item.foodId : '' };
}

export function totalsOf(items) {
  const t = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const i of items) { t.kcal += i.kcal; t.p += i.p; t.c += i.c; t.f += i.f; }
  return { kcal: Math.round(t.kcal), p: r1(t.p), c: r1(t.c), f: r1(t.f) };
}

// Does what was photographed match the planned meal? Same foods (anything
// over ~20 kcal that wasn't planned counts, sauces and oil included; a
// planned food missing from the plate counts), and calories within 15%.
export const EXTRA_MIN_KCAL = 20;
export const KCAL_TOLERANCE = 0.15;
export function compareToPlan(meal, items) {
  const plannedIds = new Set(meal.items.map((i) => i.foodId));
  const eatenIds = new Set(items.map((i) => i.foodId).filter(Boolean));
  const extra = items.filter((i) => (!i.foodId || !plannedIds.has(i.foodId)) && i.kcal >= EXTRA_MIN_KCAL).map((i) => i.name);
  const missing = meal.items.filter((i) => !eatenIds.has(i.foodId)).map((i) => FOOD_BY_ID[i.foodId].name);
  const planned = meal.items.reduce((s, i) => s + i.kcal, 0);
  const eaten = totalsOf(items).kcal;
  const kcalOff = planned > 0 ? Math.abs(eaten - planned) / planned > KCAL_TOLERANCE : eaten > 0;
  return { matches: !extra.length && !missing.length && !kcalOff, extra, missing, planned: Math.round(planned), eaten };
}

// What gets saved for a meal once the user confirms.
export function record(items, { replace, confidence }) {
  return {
    items: items.map(({ name, grams, kcal, p, c, f, foodId }) => ({ name, grams, kcal, p, c, f, foodId: foodId || '' })),
    totals: totalsOf(items),
    replace: !!replace,
    confidence: confidence || 'medium',
    at: Date.now(),
  };
}
