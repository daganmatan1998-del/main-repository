import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDay } from '../../www/js/mealplan.js';
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
const week = (prefs, weekNo, start = '2026-11-01', targets = T) =>
  [...Array(7)].map((_, i) => ({ day: addDays(start, i), meals: generateDay(addDays(start, i), targets, prefs, {}, 11, { week: weekNo, dayIndex: i }) }));

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

test('every day of the week shows different meals', () => {
  for (const prefs of PREFS.slice(0, 3)) {
    const days = week(prefs, 4);
    const signatures = new Set(days.map((d) => d.meals.map((m) => m.items.map((i) => i.foodId).join('+')).join('|')));
    assert.equal(signatures.size, 7, `${prefs.diet}: identical days`);
    for (let mi = 0; mi < days[0].meals.length; mi++) {
      const mains = new Set(days.map((d) => d.meals[mi].items.find((i) => i.slot === 'protein').foodId));
      assert.equal(mains.size, 7, `${prefs.diet}: ${days[0].meals[mi].name} repeats its main within the week`);
    }
    for (const d of days) {
      const mains = d.meals.map((m) => m.items.find((i) => i.slot === 'protein').foodId);
      assert.equal(new Set(mains).size, mains.length, `${prefs.diet}: same main twice on ${d.day}`);
    }
    const products = buildShoppingList(days).reduce((n, g) => n + g.items.length, 0);
    assert.ok(products <= 50, `${prefs.diet}: ${products} products`);
    let kcal = 0;
    let p = 0;
    for (const d of days) for (const m of d.meals) { kcal += m.totals.kcal; p += m.totals.p; }
    assert.ok(Math.abs(kcal / 7 - T.calories) / T.calories < 0.1, `${prefs.diet} kcal ${kcal / 7}`);
    assert.ok(p / 7 >= T.protein * 0.85, `${prefs.diet} protein ${p / 7}`);
  }
  // The next week starts a fresh rotation.
  const a = week(PREFS[0], 1)[0].meals.map((m) => m.items[0].foodId).join();
  const b = week(PREFS[0], 2)[0].meals.map((m) => m.items[0].foodId).join();
  assert.notEqual(a, b);
});

test('keto and carnivore menus follow their rules and targets', async () => {
  const { computeTargets } = await import('../../www/js/nutrition.js');
  const prof = { sex: 'male', age: 30, height: 180, activity: 'light', workouts: 4 };
  for (const prefs of [
    { diet: 'keto', kosher: false, allergies: [], dislikes: '', excluded: [], mealsPerDay: 4 },
    { diet: 'keto', kosher: true, allergies: ['treenut'], dislikes: '', excluded: [], mealsPerDay: 3 },
    { diet: 'carnivore', kosher: false, allergies: [], dislikes: '', excluded: [], mealsPerDay: 4 },
    { diet: 'carnivore', kosher: true, allergies: [], dislikes: '', excluded: [], mealsPerDay: 5 },
  ]) {
    const t = computeTargets({ ...prof, prefs }, { goal: 'cut', endDate: '2026-12-31', targetWeight: 75 }, { weight: 82, bf: 20 }, '2026-11-01');
    assert.ok(prefs.diet === 'keto' ? t.carbs <= 50 : t.carbs <= 10, `${prefs.diet} carb target ${t.carbs}`);
    assert.ok(t.fat * 9 > t.calories * 0.5, `${prefs.diet}: fat should supply most energy`);
    const days = week(prefs, 3, '2026-11-01', t);
    let kcal = 0;
    let carbs = 0;
    for (const d of days) {
      for (const m of d.meals) {
        kcal += m.totals.kcal;
        carbs += m.totals.c;
        for (const it of m.items) {
          const f = FOOD_BY_ID[it.foodId];
          assert.ok(isAllowed(f, prefs), `${f.id} on ${prefs.diet}`);
          assert.ok(!['carb', 'fruit'].includes(f.role), `${f.id}: ${f.role} on ${prefs.diet}`);
          if (prefs.diet === 'carnivore') assert.notEqual(f.src, 'plant', `${f.id} is a plant food`);
        }
      }
    }
    assert.ok(Math.abs(kcal / 7 - t.calories) / t.calories < 0.12, `${prefs.diet} kcal ${kcal / 7} vs ${t.calories}`);
    assert.ok(carbs / 7 <= (prefs.diet === 'keto' ? 70 : 20), `${prefs.diet} carbs ${carbs / 7}`);
  }
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
