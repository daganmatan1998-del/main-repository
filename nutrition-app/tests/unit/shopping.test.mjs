import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDay, weeklyPool, mealTemplate } from '../../www/js/mealplan.js';
import { alternatives } from '../../www/js/substitutions.js';
import { buildShoppingList, SHOP, fmtWeight } from '../../www/js/shopping.js';
import { FOODS, FOOD_BY_ID, isAllowed, canExclude, countByRole, allowedFoods, MIN_PER_ROLE, ROLES } from '../../www/js/foods.js';
import { addDays } from '../../www/js/util.js';

const T = { calories: 2100, protein: 150, carbs: 220, fat: 65 };
const PREFS = [
  { diet: 'omni', kosher: false, allergies: [], dislikes: '', excluded: [], mealsPerDay: 3 },
  { diet: 'omni', kosher: true, allergies: ['gluten'], dislikes: '', excluded: ['tuna', 'salmon', 'cottage', 'white_rice'], mealsPerDay: 4 },
  { diet: 'vegetarian', kosher: true, allergies: ['treenut'], dislikes: 'טונה', excluded: ['tofu', 'eggs'], mealsPerDay: 5 },
  { diet: 'vegan', kosher: false, allergies: ['soy', 'gluten'], dislikes: '', excluded: [], mealsPerDay: 6 },
];
const week = (prefs, poolKey, start = '2026-11-01') =>
  [...Array(7)].map((_, i) => ({ day: addDays(start, i), meals: generateDay(addDays(start, i), T, prefs, {}, 11, poolKey) }));

test('every food has shopping info', () => {
  assert.deepEqual(FOODS.filter((f) => !SHOP[f.id]).map((f) => f.id), []);
});

test('excluded foods never appear and every item keeps a substitute', () => {
  for (const prefs of PREFS) {
    for (const { meals } of week(prefs, 2)) {
      for (const meal of meals) {
        for (const it of meal.items) {
          assert.ok(!prefs.excluded.includes(it.foodId), `${it.foodId} was excluded`);
          assert.ok(isAllowed(FOOD_BY_ID[it.foodId], prefs));
          const alt = alternatives(it, meal, prefs);
          assert.ok(alt.options.length >= 1, `no substitute for ${it.foodId} in ${meal.name} (${prefs.diet})`);
          assert.ok(alt.options.every((o) => isAllowed(FOOD_BY_ID[o.foodId], prefs)));
        }
      }
    }
  }
});

test('the picker cannot leave a category without substitutes', () => {
  const prefs = { diet: 'omni', kosher: false, allergies: [], dislikes: '', excluded: [] };
  const fats = allowedFoods(prefs).filter((f) => f.role === 'fat').map((f) => f.id);
  const excluded = [];
  for (const id of fats) {
    if (canExclude(id, { ...prefs, excluded })) excluded.push(id);
  }
  assert.equal(countByRole({ ...prefs, excluded }).fat, MIN_PER_ROLE);
  for (const r of ROLES) assert.ok(countByRole(prefs)[r] >= MIN_PER_ROLE);
});

test('a menu week uses a realistic set of products and still hits the targets', () => {
  for (const prefs of PREFS) {
    const days = week(prefs, 4);
    const products = buildShoppingList(days).reduce((n, g) => n + g.items.length, 0);
    assert.ok(products <= 32, `${prefs.diet}: ${products} products`);
    const pool = new Set(weeklyPool(allowedFoods(prefs), mealTemplate(prefs.mealsPerDay).map((m) => m.type), 4, 11).map((f) => f.id));
    const used = new Set(days.flatMap((d) => d.meals.flatMap((m) => m.items.map((i) => i.foodId))));
    const outside = [...used].filter((id) => !pool.has(id));
    assert.ok(outside.length <= 1, `outside pool: ${outside}`);
    let kcal = 0;
    let p = 0;
    for (const d of days) for (const m of d.meals) { kcal += m.totals.kcal; p += m.totals.p; }
    assert.ok(Math.abs(kcal / 7 - T.calories) / T.calories < 0.1, `${prefs.diet} kcal ${kcal / 7}`);
    assert.ok(p / 7 >= T.protein * 0.85, `${prefs.diet} protein ${p / 7}`);
  }
  // Different weeks rotate the set.
  const a = new Set(weeklyPool(allowedFoods(PREFS[0]), ['b', 'l', 'd'], 1, 11).map((f) => f.id));
  const b = new Set(weeklyPool(allowedFoods(PREFS[0]), ['b', 'l', 'd'], 2, 11).map((f) => f.id));
  assert.ok([...a].some((id) => !b.has(id)));
});

test('quantities are converted to what you buy', () => {
  const day = (items) => [{ meals: [{ items }] }];
  const find = (groups, name) => groups.flatMap((g) => g.items).find((i) => i.name.includes(name));
  let g = buildShoppingList(day([{ foodId: 'white_rice', grams: 1500 }]));
  assert.equal(find(g, 'אורז').qty, '1 × שקית 1 ק״ג');
  assert.match(find(g, 'אורז').detail, /550 ג׳/); // 1500 cooked × 0.36 = 540 dry
  g = buildShoppingList(day([{ foodId: 'chicken_breast', grams: 900 }]));
  assert.equal(find(g, 'חזה עוף').qty, '1.2 ק״ג'); // 900 × 1.33 = 1197
  g = buildShoppingList(day([{ foodId: 'eggs', grams: 550 }, { foodId: 'eggs', grams: 110 }]));
  assert.equal(find(g, 'ביצים').qty, '12 ביצים (1 × תבנית 12)');
  g = buildShoppingList(day([{ foodId: 'salad', grams: 1000 }, { foodId: 'roasted_veg', grams: 500 }]));
  assert.equal(find(g, 'פלפלים').qty, '350 ג׳'); // 200 + 150 merged
  assert.equal(fmtWeight(2340), '2.4 ק״ג');
});
