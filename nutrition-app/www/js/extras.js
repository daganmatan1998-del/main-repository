// Sauces and cheese a person can add to any meal. They are not part of the
// generated menu: the person picks them, and their calories come off the rest
// of that meal (mealplan.js shrinks the other items), so the meal keeps its
// calorie budget. Low-calorie sauces are offered first.
//
// Kept apart from FOODS on purpose: these never appear in generated menus,
// swaps, recipes or the weekly shopping list.

import { raw, t as tr, trl } from './i18n.js';
import { FOOD_BY_ID, DIET_ALLOWED_SRC, kosherCompatible, dislikeMatches, parseDislikes, macrosFor } from './foods.js';

const tsp = (g = 5) => ({ u: raw('{0, plural, =0.25 {{1} teaspoon} =0.5 {{1} teaspoon} =0.75 {{1} teaspoon} one {{1} teaspoon} other {{1} teaspoons}}'), g, step: 1 });
const tbsp = (g) => ({ u: raw('{0, plural, =0.25 {{1} tablespoon} =0.5 {{1} tablespoon} =0.75 {{1} tablespoon} one {{1} tablespoon} other {{1} tablespoons}}'), g, step: 0.5 });
const cup4 = { u: raw('{0, plural, =0.25 {{1} ¼ cup} =0.5 {{1} ¼ cup} =0.75 {{1} ¼ cup} one {{1} ¼ cup} other {{1} ¼ cup}}'), g: 60, step: 1 };

// Per 100 g. serving = the grams added when tapped.
const SAUCES = [
  { id: 'x_mustard', name: tr('Mustard'), kcal: 66, p: 4, c: 6, f: 3.5, serving: 10, units: [tsp(5), tbsp(15)], src: 'plant', kosher: 'parve', allergens: [] },
  { id: 'x_lemon', name: tr('Fresh-squeezed lemon juice'), aliases: [...trl('lemon')], kcal: 22, p: 0.4, c: 7, f: 0.2, serving: 15, units: [tbsp(15)], src: 'plant', kosher: 'parve', allergens: [] },
  { id: 'x_vinegar', name: tr('Apple cider vinegar'), aliases: [...trl('vinegar')], kcal: 21, p: 0, c: 0.9, f: 0, serving: 15, units: [tbsp(15)], src: 'plant', kosher: 'parve', allergens: [] },
  { id: 'x_diet_dressing', name: tr('Low-calorie salad dressing'), aliases: [...trl('diet'), ...trl('salad dressing')], kcal: 30, p: 0.5, c: 6, f: 0.5, serving: 30, units: [tbsp(15)], src: 'plant', kosher: 'parve', allergens: [] },
  { id: 'x_hot', name: tr('Hot sauce / sriracha'), aliases: [...trl('hot'), ...trl('sriracha'), ...trl('shatta')], kcal: 93, p: 2, c: 19, f: 1, serving: 5, units: [tsp(5)], src: 'plant', kosher: 'parve', allergens: [] },
  { id: 'x_soy', name: tr('Soy sauce'), aliases: [...trl('soy')], kcal: 53, p: 8, c: 5, f: 0, serving: 15, units: [tbsp(15)], src: 'plant', kosher: 'parve', allergens: ['soy', 'gluten'] },
  { id: 'x_teriyaki', name: tr('Teriyaki sauce'), kcal: 90, p: 4, c: 16, f: 0, serving: 18, units: [tbsp(18)], src: 'plant', kosher: 'parve', allergens: ['soy', 'gluten'] },
  { id: 'x_balsamic', name: tr('Balsamic vinegar'), aliases: [...trl('balsamic')], kcal: 88, p: 0.5, c: 17, f: 0, serving: 15, units: [tbsp(15)], src: 'plant', kosher: 'parve', allergens: [] },
  { id: 'x_salsa', name: tr('Tomato salsa'), aliases: [...trl('salsa')], kcal: 36, p: 1.5, c: 7, f: 0.2, serving: 60, units: [cup4, tbsp(15)], src: 'plant', kosher: 'parve', allergens: [] },
  { id: 'x_marinara', name: tr('Tomato sauce'), aliases: [...trl('marinara'), ...trl('pasta')], kcal: 50, p: 1.5, c: 8, f: 1.5, serving: 60, units: [cup4, tbsp(15)], src: 'plant', kosher: 'parve', allergens: [] },
  { id: 'x_tzatziki', name: tr('Tzatziki (yogurt and cucumber)'), aliases: [...trl('tzatziki'), ...trl('cucumber yogurt')], kcal: 70, p: 3.5, c: 4, f: 4.5, serving: 40, units: [tbsp(20)], src: 'dairy', kosher: 'dairy', allergens: ['dairy'] },
  { id: 'x_yogurt', name: tr('Plain yogurt (as a sauce)'), aliases: [...trl('yogurt')], kcal: 61, p: 3.5, c: 4.7, f: 3.3, serving: 50, units: [tbsp(25)], src: 'dairy', kosher: 'dairy', allergens: ['dairy'] },
  { id: 'x_garlic_yogurt', name: tr('Garlic yogurt sauce'), aliases: [...trl('garlic')], kcal: 80, p: 3, c: 5, f: 5, serving: 30, units: [tbsp(15)], src: 'dairy', kosher: 'dairy', allergens: ['dairy'] },
  { id: 'x_ketchup', name: tr('Ketchup'), kcal: 100, p: 1.2, c: 25, f: 0.3, serving: 17, units: [tbsp(17)], src: 'plant', kosher: 'parve', allergens: [] },
  { id: 'x_light_mayo', name: tr('Light mayonnaise'), aliases: [...trl('mayonnaise')], kcal: 250, p: 0.5, c: 8, f: 24, serving: 15, units: [tbsp(15)], src: 'egg', kosher: 'parve', allergens: ['egg'] },
  { id: 'x_bbq', name: tr('Barbecue sauce'), aliases: [...trl('barbecue'), ...trl('barbecue')], kcal: 170, p: 1, c: 40, f: 0.5, serving: 17, units: [tbsp(17)], src: 'plant', kosher: 'parve', allergens: [] },
  { id: 'x_honey_mustard', name: tr('Honey mustard'), kcal: 190, p: 1, c: 30, f: 8, serving: 15, units: [tbsp(15)], src: 'plant', kosher: 'parve', allergens: [] },
  { id: 'x_sweet_chili', name: tr('Sweet chili sauce'), aliases: [...trl('sweet chili')], kcal: 230, p: 0.5, c: 57, f: 0.2, serving: 17, units: [tbsp(17)], src: 'plant', kosher: 'parve', allergens: [] },
  { id: 'x_tahini_sauce', name: tr('Ready-made tahini (with water and lemon)'), aliases: [...trl('tahini'), ...trl('tahini sauce')], kcal: 250, p: 7, c: 8, f: 22, serving: 30, units: [tbsp(15)], src: 'plant', kosher: 'parve', allergens: ['sesame'] },
  { id: 'x_hummus', name: tr('Hummus (spread)'), aliases: [...trl('hummus')], kcal: 166, p: 8, c: 14, f: 10, serving: 40, units: [tbsp(20)], src: 'plant', kosher: 'parve', allergens: ['sesame'] },
  { id: 'x_guacamole', name: tr('Guacamole'), aliases: [tr('Avocado')], kcal: 160, p: 2, c: 9, f: 15, serving: 30, units: [tbsp(15)], src: 'plant', kosher: 'parve', allergens: [] },
  { id: 'x_sour_cream', name: tr('Sour cream 15%'), aliases: [...trl('cream')], kcal: 160, p: 3, c: 4, f: 15, serving: 30, units: [tbsp(15)], src: 'dairy', kosher: 'dairy', allergens: ['dairy'] },
  { id: 'x_vinaigrette', name: tr('Vinaigrette (oil and vinegar)'), aliases: [...trl('vinaigrette'), ...trl('salad dressing')], kcal: 400, p: 0, c: 3, f: 43, serving: 15, units: [tbsp(15)], src: 'plant', kosher: 'parve', allergens: [] },
  { id: 'x_pesto', name: tr('Pesto'), kcal: 460, p: 5, c: 6, f: 46, serving: 15, units: [tbsp(15)], src: 'dairy', kosher: 'dairy', allergens: ['dairy', 'treenut'] },
  { id: 'x_mayo', name: tr('mayonnaise'), kcal: 680, p: 1, c: 1, f: 75, serving: 14, units: [tbsp(14)], src: 'egg', kosher: 'parve', allergens: ['egg'] },
  { id: 'x_olive_oil', name: tr('Olive oil'), aliases: [...trl('oil')], kcal: 884, p: 0, c: 0, f: 100, serving: 5, units: [tsp(5), tbsp(13.5)], src: 'plant', kosher: 'parve', allergens: [] },
].map((s) => ({ ...s, aliases: s.aliases || [], group: 'sauce', role: 'sauce', min: 1, max: 200 }));

// Cheeses already in the food table; added here with a small serving.
const CHEESE_SERVING = { cottage: 50, white_cheese: 30, feta: 30, mozzarella: 30, hard_cheese: 20 };

export const EXTRA_BY_ID = Object.fromEntries(SAUCES.map((s) => [s.id, s]));
export const extraFood = (id) => EXTRA_BY_ID[id] || (CHEESE_SERVING[id] ? FOOD_BY_ID[id] : null);

export const LIGHT_KCAL = 25; // a serving at or under this is a "light" sauce
export const MAX_EXTRAS = 4;

export function extraMacros(foodId, grams) {
  const f = extraFood(foodId);
  return f ? macrosFor(f, grams) : { kcal: 0, p: 0, c: 0, f: 0 };
}

export function extraAllowed(f, prefs, mealFoods = []) {
  const diet = prefs.diet || 'omni';
  if (!DIET_ALLOWED_SRC[diet].includes(f.src)) return false;
  // Keto: nothing with more than 3 g of carbs in a serving.
  if (diet === 'keto' && (f.c * (CHEESE_SERVING[f.id] || f.serving)) / 100 > 3) return false;
  if (prefs.kosher && f.nonKosher) return false;
  if (prefs.kosher && !kosherCompatible(f, mealFoods)) return false;
  if ((f.allergens || []).some((a) => (prefs.allergies || []).includes(a))) return false;
  if (dislikeMatches(f, parseDislikes(prefs.dislikes))) return false;
  return true;
}

// Everything the person can add to this meal: light sauces first (lowest
// calories first), then the other sauces, then cheeses.
export function extraOptions(prefs, mealFoods = []) {
  const make = (f, group) => {
    const serving = CHEESE_SERVING[f.id] || f.serving;
    const k = macrosFor(f, serving).kcal;
    return { food: f, group, serving, kcal: Math.round(k), light: group === 'sauce' && k <= LIGHT_KCAL };
  };
  const sauces = SAUCES.filter((f) => extraAllowed(f, prefs, mealFoods)).map((f) => make(f, 'sauce'));
  const cheeses = Object.keys(CHEESE_SERVING).map((id) => FOOD_BY_ID[id]).filter((f) => f && extraAllowed(f, prefs, mealFoods)).map((f) => make(f, 'cheese'));
  const byKcal = (a, b) => a.kcal - b.kcal;
  return [...sauces.filter((o) => o.light).sort(byKcal), ...sauces.filter((o) => !o.light).sort(byKcal), ...cheeses.sort(byKcal)];
}
