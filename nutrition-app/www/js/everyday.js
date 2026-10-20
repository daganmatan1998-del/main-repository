// Everyday foods people eat even when the menu says otherwise: sausages, fries,
// Bamba, pizza, chocolate… They are never part of a generated menu, swap or the
// shopping list. The person picks them in "Add your own food" (custom-food.js),
// and their calories either come off the rest of the meal or are added to it.
//
// Per 100 g as eaten (rounded from USDA FoodData Central, Israeli Ministry of
// Health tables and package labels — packaged snacks vary by brand, so these
// are typical values and the person can always type their own).
// units: household measure, g = grams of one unit, step = smallest sensible
// change. src / allergens feed the diet and allergy filters.

import { raw, t as tr, trl } from './i18n.js';
import { DIET_ALLOWED_SRC, macrosFor, household } from './foods.js';

const PIECE = { u: raw('{0, plural, =0.25 {{1} piece} =0.5 {{1} piece} =0.75 {{1} piece} one {{1} piece} other {{1} pieces}}'), step: 1 };
const PORTION = { u: raw('{0, plural, =0.25 {{1} portion} =0.5 {{1} portion} =0.75 {{1} portion} one {{1} portion} other {{1} portions}}'), step: 0.5 };
const SLICE = { u: raw('{0, plural, =0.25 {{1} slice} =0.5 {{1} slice} =0.75 {{1} slice} one {{1} slice} other {{1} slices}}'), step: 1 };
const BAG = { u: raw('{0, plural, =0.25 {{1} small bag} =0.5 {{1} small bag} =0.75 {{1} small bag} one {{1} small bag} other {{1} small bags}}'), step: 0.5 };
const BAR = { u: raw('{0, plural, =0.25 {{1} bar} =0.5 {{1} bar} =0.75 {{1} bar} one {{1} bar} other {{1} bars}}'), step: 0.5 };
const SCOOP = { u: raw('{0, plural, =0.25 {{1} scoop} =0.5 {{1} scoop} =0.75 {{1} scoop} one {{1} scoop} other {{1} scoops}}'), step: 1 };
const TBSP = { u: raw('{0, plural, =0.25 {{1} tablespoon} =0.5 {{1} tablespoon} =0.75 {{1} tablespoon} one {{1} tablespoon} other {{1} tablespoons}}'), step: 0.5 };
const TSP = { u: raw('{0, plural, =0.25 {{1} teaspoon} =0.5 {{1} teaspoon} =0.75 {{1} teaspoon} one {{1} teaspoon} other {{1} teaspoons}}'), step: 1 };

// def = how many units one tap adds.
const FOODS = [
  // ---- sausages, meat and fried food ----
  { id: 'hot_dog', name: tr('Hot dog / sausage'), aliases: [...trl('hot dog|frankfurter|sausage|wiener')], kcal: 290, p: 11, c: 3, f: 26, unit: { ...PIECE, g: 50 }, def: 1, src: 'meat', allergens: [] },
  { id: 'chicken_hot_dog', name: tr('Chicken or turkey hot dog'), aliases: [...trl('chicken sausage|turkey sausage|poultry hot dog')], kcal: 195, p: 13, c: 4, f: 14, unit: { ...PIECE, g: 45 }, def: 1, src: 'poultry', allergens: [] },
  { id: 'merguez', name: tr('Grilled spicy sausage (merguez)'), aliases: [...trl('merguez|spicy sausage|grilled sausage')], kcal: 290, p: 14, c: 2, f: 25, unit: { ...PIECE, g: 60 }, def: 1, src: 'meat', allergens: [] },
  { id: 'salami', name: tr('Salami'), aliases: [...trl('salami|cold cuts|deli meat')], kcal: 335, p: 22, c: 1, f: 27, unit: { ...SLICE, g: 10 }, def: 3, src: 'meat', allergens: [] },
  { id: 'schnitzel', name: tr('Chicken schnitzel (breaded, fried)'), aliases: [...trl('schnitzel|breaded chicken|cutlet')], kcal: 250, p: 17, c: 14, f: 14, unit: { ...PIECE, g: 120 }, def: 1, src: 'poultry', allergens: ['gluten', 'egg'] },
  { id: 'nuggets', name: tr('Chicken nuggets'), aliases: [...trl('nuggets|chicken nuggets|fried chicken bites')], kcal: 295, p: 15, c: 18, f: 18, unit: { ...PIECE, g: 18 }, def: 6, src: 'poultry', allergens: ['gluten'] },
  { id: 'fried_chicken', name: tr('Fried chicken (breaded, with skin)'), aliases: [...trl('fried chicken|chicken wings|drumstick')], kcal: 275, p: 22, c: 8, f: 17, unit: { ...PIECE, g: 100 }, def: 1, src: 'poultry', allergens: ['gluten'] },
  { id: 'shawarma_meat', name: tr('Shawarma (meat only)'), aliases: [...trl('shawarma|doner|gyros')], kcal: 220, p: 22, c: 1, f: 14, unit: { ...PORTION, g: 150 }, def: 1, src: 'meat', allergens: [] },
  { id: 'kebab', name: tr('Kebab (grilled minced-meat skewer)'), aliases: [...trl('kebab|kabab|skewer|minced meat skewer')], kcal: 245, p: 17, c: 2, f: 19, unit: { ...PIECE, g: 70 }, def: 2, src: 'meat', allergens: [] },
  { id: 'burger', name: tr('Hamburger with a bun'), aliases: [...trl('burger|hamburger|beef burger')], kcal: 250, p: 13, c: 25, f: 11, unit: { ...PIECE, g: 200 }, def: 1, src: 'meat', allergens: ['gluten', 'sesame'] },
  { id: 'cheeseburger', name: tr('Cheeseburger with a bun'), aliases: [...trl('cheeseburger|burger with cheese')], kcal: 280, p: 14, c: 24, f: 14, unit: { ...PIECE, g: 220 }, def: 1, src: 'meat', allergens: ['gluten', 'sesame', 'dairy'] },
  { id: 'fries', name: tr('French fries'), aliases: [...trl('fries|french fries|chips|potato fries')], kcal: 313, p: 3.4, c: 41, f: 15, unit: { ...PORTION, g: 150 }, def: 1, src: 'plant', allergens: [] },
  { id: 'onion_rings', name: tr('Onion rings'), aliases: [...trl('onion rings|fried onion')], kcal: 410, p: 5, c: 41, f: 25, unit: { ...PORTION, g: 100 }, def: 1, src: 'plant', allergens: ['gluten'] },
  { id: 'pizza', name: tr('Pizza'), aliases: [...trl('pizza|pizza slice')], kcal: 266, p: 11, c: 33, f: 10, unit: { ...SLICE, g: 110 }, def: 2, src: 'dairy', allergens: ['gluten', 'dairy'] },
  { id: 'falafel_ball', name: tr('Falafel balls'), aliases: [...trl('falafel|falafel balls')], kcal: 340, p: 13, c: 32, f: 18, unit: { ...PIECE, g: 17 }, def: 5, src: 'plant', allergens: ['sesame'] },
  { id: 'falafel_pita', name: tr('Falafel in a pita (with salad and tahini)'), aliases: [...trl('falafel in pita|falafel pita|falafel sandwich')], kcal: 260, p: 9, c: 31, f: 11, unit: { ...PIECE, g: 300 }, def: 1, src: 'plant', allergens: ['gluten', 'sesame'] },
  { id: 'shawarma_pita', name: tr('Shawarma in a pita'), aliases: [...trl('shawarma in pita|shawarma pita|shawarma sandwich')], kcal: 215, p: 11, c: 22, f: 9, unit: { ...PIECE, g: 350 }, def: 1, src: 'meat', allergens: ['gluten', 'sesame'] },
  { id: 'burekas', name: tr('Burekas (cheese or potato)'), aliases: [...trl('burekas|bourekas|pastry')], kcal: 335, p: 8, c: 28, f: 21, unit: { ...PIECE, g: 90 }, def: 1, src: 'dairy', allergens: ['gluten', 'dairy', 'egg', 'sesame'] },
  { id: 'malawach', name: tr('Malawach / jachnun'), aliases: [...trl('malawach|jachnun|yemenite pastry')], kcal: 380, p: 7, c: 45, f: 19, unit: { ...PIECE, g: 130 }, def: 1, src: 'plant', allergens: ['gluten'] },
  { id: 'toast_cheese', name: tr('Toasted cheese sandwich'), aliases: [...trl('toast|toasted sandwich|grilled cheese')], kcal: 330, p: 14, c: 30, f: 17, unit: { ...PIECE, g: 130 }, def: 1, src: 'dairy', allergens: ['gluten', 'dairy'] },
  { id: 'sushi', name: tr('Sushi roll'), aliases: [...trl('sushi|maki|sushi roll')], kcal: 145, p: 5, c: 28, f: 1.5, unit: { ...PIECE, g: 30 }, def: 6, src: 'fish', allergens: ['fish', 'soy'] },
  { id: 'instant_noodles', name: tr('Instant noodles (dry)'), aliases: [...trl('instant noodles|ramen|noodle soup')], kcal: 445, p: 9, c: 62, f: 18, unit: { ...PORTION, g: 75 }, def: 1, src: 'plant', allergens: ['gluten'] },
  { id: 'shakshuka', name: tr('Shakshuka'), aliases: [...trl('shakshuka|eggs in tomato sauce')], kcal: 100, p: 6, c: 5, f: 6, unit: { ...PORTION, g: 250 }, def: 1, src: 'egg', allergens: ['egg'] },
  { id: 'creamy_pasta', name: tr('Pasta in cream sauce'), aliases: [...trl('creamy pasta|alfredo|pasta with cream')], kcal: 190, p: 5, c: 22, f: 9, unit: { ...PORTION, g: 300 }, def: 1, src: 'dairy', allergens: ['gluten', 'dairy'] },
  { id: 'pancakes', name: tr('Pancakes'), aliases: [...trl('pancakes|pancake|crepe')], kcal: 225, p: 6, c: 28, f: 10, unit: { ...PIECE, g: 50 }, def: 2, src: 'dairy', allergens: ['gluten', 'dairy', 'egg'] },
  { id: 'waffle', name: tr('Waffle'), aliases: [...trl('waffle|waffles')], kcal: 290, p: 8, c: 33, f: 14, unit: { ...PIECE, g: 75 }, def: 1, src: 'dairy', allergens: ['gluten', 'dairy', 'egg'] },
  { id: 'cream_cheese', name: tr('Cream cheese'), aliases: [...trl('cream cheese|spread cheese|philadelphia')], kcal: 345, p: 6, c: 4, f: 34, unit: { ...TBSP, g: 15 }, def: 1, src: 'dairy', allergens: ['dairy'] },
  { id: 'butter', name: tr('Butter'), aliases: [...trl('butter|margarine')], kcal: 730, p: 1, c: 0, f: 81, unit: { ...TSP, g: 5 }, def: 2, src: 'dairy', allergens: ['dairy'] },

  // ---- snacks ----
  { id: 'bamba', name: tr('Bamba (peanut snack)'), aliases: [...trl('bamba|peanut puffs|peanut snack')], kcal: 520, p: 15, c: 38, f: 34, unit: { ...BAG, g: 30 }, def: 1, src: 'plant', allergens: ['peanut'] },
  { id: 'bissli', name: tr('Bissli (savory wheat snack)'), aliases: [...trl('bissli|savory snack|wheat snack')], kcal: 500, p: 8, c: 58, f: 26, unit: { ...BAG, g: 30 }, def: 1, src: 'plant', allergens: ['gluten'] },
  { id: 'potato_chips', name: tr('Potato chips'), aliases: [...trl('potato chips|crisps|chips bag')], kcal: 540, p: 7, c: 53, f: 34, unit: { ...BAG, g: 30 }, def: 1, src: 'plant', allergens: [] },
  { id: 'tortilla_chips', name: tr('Corn / tortilla chips'), aliases: [...trl('tortilla chips|corn chips|doritos|nachos')], kcal: 490, p: 7, c: 60, f: 25, unit: { ...BAG, g: 30 }, def: 1, src: 'plant', allergens: [] },
  { id: 'popcorn', name: tr('Popcorn (with oil or butter)'), aliases: [...trl('popcorn|movie popcorn')], kcal: 500, p: 9, c: 55, f: 28, unit: { ...PORTION, g: 40 }, def: 1, src: 'plant', allergens: [] },
  { id: 'pretzels', name: tr('Pretzels'), aliases: [...trl('pretzels|salty sticks|crackers')], kcal: 385, p: 10, c: 80, f: 3, unit: { ...PORTION, g: 30 }, def: 1, src: 'plant', allergens: ['gluten'] },

  // ---- sweets ----
  { id: 'milk_chocolate', name: tr('Milk chocolate'), aliases: [...trl('chocolate|milk chocolate|chocolate bar')], kcal: 535, p: 7.5, c: 59, f: 30, unit: { ...PIECE, g: 10 }, def: 3, src: 'dairy', allergens: ['dairy', 'soy'] },
  { id: 'dark_chocolate', name: tr('Dark chocolate'), aliases: [...trl('dark chocolate|bitter chocolate|chocolate 70%')], kcal: 600, p: 8, c: 46, f: 43, unit: { ...PIECE, g: 10 }, def: 3, src: 'plant', allergens: ['soy'] },
  { id: 'chocolate_spread', name: tr('Chocolate spread'), aliases: [...trl('chocolate spread|nutella|hazelnut spread')], kcal: 540, p: 6, c: 58, f: 31, unit: { ...TBSP, g: 20 }, def: 1, src: 'dairy', allergens: ['dairy', 'treenut', 'soy'] },
  { id: 'wafer', name: tr('Chocolate wafer bar'), aliases: [...trl('wafer|chocolate wafer|kit kat')], kcal: 515, p: 6, c: 62, f: 27, unit: { ...BAR, g: 40 }, def: 1, src: 'dairy', allergens: ['gluten', 'dairy', 'soy'] },
  { id: 'cookies', name: tr('Cookies'), aliases: [...trl('cookies|biscuits|cookie')], kcal: 480, p: 5, c: 66, f: 22, unit: { ...PIECE, g: 15 }, def: 2, src: 'dairy', allergens: ['gluten', 'dairy', 'egg'] },
  { id: 'cake', name: tr('Cake (chocolate or vanilla)'), aliases: [...trl('cake|chocolate cake|sponge cake')], kcal: 370, p: 5, c: 50, f: 17, unit: { ...SLICE, g: 80 }, def: 1, src: 'dairy', allergens: ['gluten', 'dairy', 'egg'] },
  { id: 'croissant', name: tr('Croissant'), aliases: [...trl('croissant|butter pastry')], kcal: 405, p: 8, c: 46, f: 21, unit: { ...PIECE, g: 60 }, def: 1, src: 'dairy', allergens: ['gluten', 'dairy', 'egg'] },
  { id: 'donut', name: tr('Donut'), aliases: [...trl('donut|doughnut|sufganiyah')], kcal: 410, p: 5, c: 45, f: 23, unit: { ...PIECE, g: 70 }, def: 1, src: 'dairy', allergens: ['gluten', 'dairy', 'egg'] },
  { id: 'ice_cream', name: tr('Ice cream'), aliases: [...trl('ice cream|gelato|ice cream scoop')], kcal: 210, p: 3.5, c: 24, f: 11, unit: { ...SCOOP, g: 60 }, def: 2, src: 'dairy', allergens: ['dairy'] },
  { id: 'popsicle', name: tr('Ice pop (fruit popsicle)'), aliases: [...trl('popsicle|ice pop|ice lolly')], kcal: 70, p: 0, c: 17, f: 0, unit: { ...PIECE, g: 60 }, def: 1, src: 'plant', allergens: [] },
  { id: 'gummies', name: tr('Gummy candy'), aliases: [...trl('gummies|candy|sweets|jelly candy')], kcal: 335, p: 6, c: 77, f: 0, unit: { ...PORTION, g: 30 }, def: 1, src: 'plant', allergens: [] },
  { id: 'halva', name: tr('Halva'), aliases: [...trl('halva|halvah|tahini sweet')], kcal: 520, p: 12, c: 50, f: 30, unit: { ...PORTION, g: 30 }, def: 1, src: 'plant', allergens: ['sesame'] },
  { id: 'baklava', name: tr('Baklava'), aliases: [...trl('baklava|syrup pastry|kadayif')], kcal: 430, p: 6, c: 45, f: 25, unit: { ...PIECE, g: 40 }, def: 1, src: 'plant', allergens: ['gluten', 'treenut'] },
  { id: 'sweet_cereal', name: tr('Sweetened breakfast cereal'), aliases: [...trl('cereal|cornflakes|chocolate cereal')], kcal: 385, p: 7, c: 85, f: 2, unit: { ...PORTION, g: 40 }, def: 1, src: 'plant', allergens: ['gluten'] },
  { id: 'granola_bar', name: tr('Granola bar'), aliases: [...trl('granola bar|cereal bar|snack bar')], kcal: 440, p: 7, c: 65, f: 17, unit: { ...BAR, g: 35 }, def: 1, src: 'plant', allergens: ['gluten', 'peanut', 'treenut'] },
  { id: 'protein_bar', name: tr('Protein bar'), aliases: [...trl('protein bar|energy bar')], kcal: 370, p: 33, c: 35, f: 11, unit: { ...BAR, g: 60 }, def: 1, src: 'dairy', allergens: ['dairy', 'soy'] },
  { id: 'jam', name: tr('Jam'), aliases: [...trl('jam|jelly|fruit spread|marmalade')], kcal: 260, p: 0.4, c: 65, f: 0.1, unit: { ...TBSP, g: 20 }, def: 1, src: 'plant', allergens: [] },
  { id: 'honey', name: tr('Honey'), aliases: [...trl('honey|date honey|silan')], kcal: 305, p: 0.3, c: 82, f: 0, unit: { ...TBSP, g: 21 }, def: 1, src: 'plant', allergens: [] },
  { id: 'sugar', name: tr('Sugar'), aliases: [...trl('sugar|brown sugar')], kcal: 387, p: 0, c: 100, f: 0, unit: { ...TSP, g: 4 }, def: 1, src: 'plant', allergens: [] },
];

export const EVERYDAY = FOODS.map((f) => ({ ...f, units: [f.unit], role: 'everyday', min: 1, max: 2000 }));
export const EVERYDAY_BY_ID = Object.fromEntries(EVERYDAY.map((f) => [f.id, f]));
export const MAX_CUSTOM = 6;

// Diet and allergy filters. Kosher and dislikes are not applied: the person
// is choosing a food on purpose.
export function everydayAllowed(f, prefs) {
  const diet = prefs.diet || 'omni';
  if (!DIET_ALLOWED_SRC[diet].includes(f.src)) return false;
  if (diet === 'keto' && (f.c * f.units[0].g) / 100 > 8) return false;
  return !(f.allergens || []).some((a) => (prefs.allergies || []).includes(a));
}

export function everydayOptions(prefs) {
  return EVERYDAY.filter((f) => everydayAllowed(f, prefs)).map((f) => {
    const grams = f.units[0].g * f.def;
    const m = macrosFor(f, grams);
    return { food: f, grams, kcal: Math.round(m.kcal), amount: household(f, grams) };
  });
}

const r1 = (n) => Math.round(n * 10) / 10;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// A custom entry as stored in the meal's overrides. Either a common food
// (ref + servings, so the amount can be changed later) or typed by hand.
// mode: 'offset' = the rest of the meal gets smaller; 'add' = on top of the
// meal. slot: the plan item it replaces (from the swap sheet), if any.
export function makeCustom({ name, kcal, p = 0, c = 0, f = 0, mode = 'offset', slot = null, ref = null, servings = 1, note = '', fi, su, na }) {
  const out = { name: String(name || '').trim().slice(0, 40), mode: mode === 'add' ? 'add' : 'offset' };
  if (ref && EVERYDAY_BY_ID[ref]) {
    const food = EVERYDAY_BY_ID[ref];
    const s = Math.min(40, Math.max(food.units[0].step || 0.5, num(servings)));
    const m = macrosFor(food, s * food.units[0].g);
    Object.assign(out, { ref, servings: s, kcal: Math.round(m.kcal), p: r1(m.p), c: r1(m.c), f: r1(m.f) });
  } else {
    Object.assign(out, { kcal: Math.round(Math.min(5000, Math.max(0, num(kcal)))), p: r1(Math.min(500, Math.max(0, num(p)))), c: r1(Math.min(500, Math.max(0, num(c)))), f: r1(Math.min(500, Math.max(0, num(f)))) });
  }
  // Label values of a scanned product (fiber g, sugars g, sodium mg), for the nutrient totals.
  if (!out.ref) {
    for (const [k, v, cap] of [['fi', fi, 500], ['su', su, 500], ['na', na, 20000]]) {
      if (v != null && Number.isFinite(Number(v))) out[k] = r1(Math.min(cap, Math.max(0, Number(v))));
    }
  }
  if (slot) out.slot = String(slot);
  if (note && !out.ref) out.note = String(note).trim().slice(0, 40);
  return out;
}

// The stored entry with the amount changed (common foods only).
export function withServings(entry, servings) {
  return makeCustom({ ...entry, servings });
}

export const customValid = (e) => !!(e && e.name && Number.isFinite(e.kcal) && e.kcal > 0);
