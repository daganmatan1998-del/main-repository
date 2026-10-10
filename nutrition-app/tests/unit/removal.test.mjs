import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDay, retarget, validRemoval, slotGroup, GROUPS } from '../../www/js/mealplan.js';
import { recipesForMeal } from '../../www/js/recipes.js';
import { FOOD_BY_ID, isAllowed } from '../../www/js/foods.js';
import { addDays } from '../../www/js/util.js';

const T = { calories: 2200, protein: 160, carbs: 230, fat: 70 };
const PREFS = [
  { diet: 'omni', kosher: true, allergies: [], dislikes: '', excluded: [], mealsPerDay: 4 },
  { diet: 'vegetarian', kosher: true, allergies: ['treenut'], dislikes: '', excluded: [], mealsPerDay: 5 },
  { diet: 'vegan', kosher: false, allergies: [], dislikes: '', excluded: [], mealsPerDay: 3 },
  { diet: 'pescatarian', kosher: true, allergies: ['dairy'], dislikes: '', excluded: [], mealsPerDay: 6 },
];
const kcal = (t) => t.p * 4 + t.c * 4 + t.f * 9;
const plan = (d) => ({ week: 1, dayIndex: d });
const all = (n, removed) => Object.fromEntries([...Array(n)].map((_, i) => [i, { removed }]));

test('removed calories are shared among the remaining macros by their share', () => {
  const t = { kcal: 600, p: 40, c: 60, f: 20 };
  const noCarb = retarget(t, ['carb']);
  assert.equal(noCarb.c, 0);
  assert.ok(Math.abs(kcal(noCarb) - kcal(t)) < 0.01, 'calories kept');
  // Protein had 160 kcal and fat 180, so fat takes the larger part of the 240 freed.
  assert.ok(Math.abs((noCarb.p - 40) * 4 - 240 * 160 / 340) < 0.01);
  assert.ok(Math.abs((noCarb.f - 20) * 9 - 240 * 180 / 340) < 0.01);
  assert.deepEqual(retarget(t, ['veg']), t);
});

test('removal rules: one macro at a time, vegetables any time, never fat alone', () => {
  const full = ['protein', 'carb', 'fat', 'veg'];
  assert.deepEqual(validRemoval(full, ['carb', 'veg']), ['carb', 'veg']);
  assert.deepEqual(validRemoval(full, ['carb', 'fat']), ['carb']);
  assert.deepEqual(validRemoval(['protein', 'fat', 'veg'], ['protein']), [], 'keto without protein would be fat only');
  assert.deepEqual(validRemoval(['protein', 'fat', 'veg'], ['fat', 'veg']), ['fat', 'veg']);
  assert.deepEqual(validRemoval(full, ['bread']), []);
});

test('a removed group is gone from the meal and the meal keeps its calories', () => {
  const errs = [];
  for (const prefs of PREFS) {
    for (let d = 0; d < 7; d++) {
      const day = addDays('2026-11-01', d);
      const base = generateDay(day, T, prefs, {}, 3, plan(d));
      for (const g of GROUPS) {
        const meals = generateDay(day, T, prefs, all(prefs.mealsPerDay, [g]), 3, plan(d));
        let dayKcal = 0;
        for (const m of meals) {
          dayKcal += m.totals.kcal;
          if (!m.removable.includes(g)) continue;
          assert.deepEqual(m.removed, [g]);
          for (const it of m.items) {
            assert.notEqual(slotGroup(it.slot), g, `${m.name} still has ${it.slot}`);
            assert.ok(isAllowed(FOOD_BY_ID[it.foodId], prefs), it.foodId);
          }
          if (g === 'carb') assert.ok(!m.items.some((i) => i.role === 'carb' || i.role === 'fruit'));
          assert.equal(new Set(m.items.map((i) => i.foodId)).size, m.items.length, 'no food twice in a meal');
          errs.push(Math.abs(m.totals.kcal - m.target.kcal) / m.target.kcal);
        }
        const baseKcal = base.reduce((s, m) => s + m.totals.kcal, 0);
        assert.ok(Math.abs(dayKcal - baseKcal) / baseKcal < 0.12, `${prefs.diet} without ${g}: ${dayKcal} vs ${baseKcal}`);
      }
    }
  }
  errs.sort((a, b) => a - b);
  assert.ok(errs[Math.floor(errs.length / 2)] < 0.06, `median meal error ${errs[Math.floor(errs.length / 2)]}`);
});

test('removals only touch their own meal, and survive "another meal"', () => {
  const prefs = PREFS[0];
  const base = generateDay('2026-11-03', T, prefs, {}, 3, plan(2));
  const ov = { 1: { removed: ['carb'], reseed: 2 } };
  const meals = generateDay('2026-11-03', T, prefs, ov, 3, plan(2));
  assert.deepEqual(meals[0], base[0]);
  assert.deepEqual(meals[1].removed, ['carb']);
  assert.ok(!meals[1].items.some((i) => i.role === 'carb'));
});

test('a swap made before a removal is re-fitted to the new meal', () => {
  const prefs = PREFS[0];
  const base = generateDay('2026-11-04', T, prefs, {}, 3, plan(3));
  const carb = base[0].items.find((i) => i.slot === 'carb');
  const other = ['oats', 'wholewheat_bread', 'rye_bread'].find((id) => id !== carb.foodId);
  const swap = { carb: { foodId: other, grams: 30 } };
  const meals = generateDay('2026-11-04', T, prefs, { 0: { swaps: swap, removed: ['protein'] } }, 3, plan(3));
  const m = meals[0];
  assert.ok(m.items.some((i) => i.foodId === other));
  assert.ok(Math.abs(m.totals.kcal - m.target.kcal) / m.target.kcal < 0.15, `${m.totals.kcal} vs ${m.target.kcal}`);
});

test('meals without protein still get plenty of recipes', () => {
  for (const prefs of PREFS) {
    for (let d = 0; d < 3; d++) {
      for (const m of generateDay(addDays('2026-11-01', d), T, prefs, all(prefs.mealsPerDay, ['protein']), 3, plan(d))) {
        const list = recipesForMeal(m, prefs, { day: 'x' });
        assert.ok(list.length >= 20, `${prefs.diet} ${m.name}: ${list.length}`);
        for (const r of list.slice(0, 50)) assert.ok(r.steps.every((s) => s && !/null|undefined|NaN/.test(s)));
      }
    }
  }
});
