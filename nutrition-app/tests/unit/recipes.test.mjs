import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDay } from '../../www/js/mealplan.js';
import { recipesForMeal, filterRecipes, PANTRY } from '../../www/js/recipes.js';
import { FOOD_BY_ID, isAllowed } from '../../www/js/foods.js';
import { addDays } from '../../www/js/util.js';

const T = { calories: 2000, protein: 150, carbs: 210, fat: 62 };
const PREFS = [
  { diet: 'omni', kosher: true, allergies: [], dislikes: '', excluded: [], mealsPerDay: 4 },
  { diet: 'vegetarian', kosher: true, allergies: ['treenut'], dislikes: '', excluded: [], mealsPerDay: 5 },
  { diet: 'vegan', kosher: false, allergies: ['soy', 'gluten'], dislikes: '', excluded: [], mealsPerDay: 4 },
  { diet: 'keto', kosher: false, allergies: [], dislikes: '', excluded: [], mealsPerDay: 3 },
  { diet: 'carnivore', kosher: true, allergies: [], dislikes: '', excluded: [], mealsPerDay: 4 },
];
const week = (prefs) => [...Array(7)].flatMap((_, d) => generateDay(addDays('2026-11-01', d), T, prefs, {}, 5, { week: 2, dayIndex: d }));

test('every meal of every diet has plenty of recipes', () => {
  for (const prefs of PREFS) {
    for (const meal of week(prefs)) {
      const n = recipesForMeal(meal, prefs, { day: 'd' }).length;
      assert.ok(n >= 40, `${prefs.diet} ${meal.name}: only ${n} recipes`);
    }
  }
});

test('recipes use exactly the meal amounts and only allowed foods', () => {
  for (const prefs of PREFS) {
    for (const meal of week(prefs).slice(0, 8)) {
      const recipes = recipesForMeal(meal, prefs, { day: 'd' });
      for (const r of recipes) {
        for (const i of r.ingredients) assert.ok(isAllowed(FOOD_BY_ID[i.foodId], prefs), `${r.title}: ${i.foodId}`);
        if (!r.swaps.length) {
          for (const i of r.ingredients) {
            const planned = meal.items.find((x) => x.foodId === i.foodId);
            assert.ok(planned, `${r.title}: ${i.foodId} not in the meal`);
            assert.equal(i.grams, planned.grams);
          }
        }
        assert.ok(r.steps.length >= 3 && r.steps.every((s) => typeof s === 'string' && s.length > 5));
        assert.ok(!/null|undefined|NaN/.test(r.title + r.steps.join()));
      }
      // Soy sauce never reaches people allergic to soy or gluten.
      if ((prefs.allergies || []).some((a) => a === 'soy' || a === 'gluten')) {
        assert.ok(recipes.every((r) => !r.pantry.includes('רוטב סויה')));
      }
      assert.equal(new Set(recipes.map((r) => r.title)).size, recipes.length, 'titles are unique');
    }
  }
});

test('filters: pantry, tool, time, style, favourites and planned-only', () => {
  const prefs = PREFS[0];
  const meal = week(prefs)[1];
  const all = recipesForMeal(meal, prefs, { day: 'd' });
  const have = ['שום', 'לימון'];
  const pantryOnly = filterRecipes(all, { pantryOnly: true, have });
  assert.ok(pantryOnly.length > 0 && pantryOnly.every((r) => r.pantry.every((p) => have.includes(p))));
  assert.ok(filterRecipes(all, { tools: ['oven'] }).every((r) => r.tool === 'oven'));
  assert.ok(filterRecipes(all, { maxTime: 20 }).every((r) => r.time <= 20));
  assert.ok(filterRecipes(all, { cuisines: ['asian'] }).every((r) => r.cuisine === 'asian'));
  assert.ok(filterRecipes(all, { noSwaps: true }).every((r) => r.swaps.length === 0));
  assert.ok(filterRecipes(all, { noSpicy: true }).every((r) => !r.spicy));
  assert.deepEqual(filterRecipes(all, { favorites: true, favIds: [all[3].id] }).map((r) => r.id), [all[3].id]);
  assert.ok(PANTRY.length >= 20);
  // Same day, same order; another day, another order.
  assert.deepEqual(recipesForMeal(meal, prefs, { day: 'd' }).slice(0, 5).map((r) => r.id), all.slice(0, 5).map((r) => r.id));
  assert.notDeepEqual(recipesForMeal(meal, prefs, { day: 'e' }).slice(0, 5).map((r) => r.id), all.slice(0, 5).map((r) => r.id));
});
