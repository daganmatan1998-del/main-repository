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
  assert.deepEqual(validRemoval([...full, 'fruit'], ['carb', 'fruit', 'veg']), ['carb', 'fruit', 'veg']);
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
          // Nothing is added in place of what was removed: the meal keeps
          // only foods that were already on the full plate.
          // (The one exception: if only seeds and salad would be left, the
          // carb picked for this meal comes back.)
          const before = base[m.index].items;
          const leftover = before.filter((i) => slotGroup(i.slot) !== g);
          const onlyFat = !leftover.some((i) => ['protein', 'carb', 'fruit'].includes(i.role));
          const added = m.items.filter((i) => !before.some((b) => b.foodId === i.foodId));
          if (onlyFat) assert.ok(added.every((i) => i.role === 'carb'), `${prefs.diet} ${m.name}`);
          else assert.deepEqual(added.map((i) => i.foodId), [], `${prefs.diet} ${m.name} without ${g}`);
          assert.ok(m.items.length < base[m.index].items.length + 1);
          assert.equal(new Set(m.items.map((i) => i.foodId)).size, m.items.length, 'no food twice in a meal');
          errs.push(Math.abs(m.totals.kcal - m.target.kcal) / m.target.kcal);
        }
        const baseKcal = base.reduce((s, m) => s + m.totals.kcal, 0);
        assert.ok(Math.abs(dayKcal - baseKcal) / baseKcal < 0.12, `${prefs.diet} without ${g}: ${dayKcal} vs ${baseKcal}`);
      }
    }
  }
  errs.sort((a, b) => a - b);
  assert.ok(errs[Math.floor(errs.length / 2)] < 0.03, `median meal error ${errs[Math.floor(errs.length / 2)]}`);
  assert.ok(errs[Math.floor(errs.length * 0.9)] < 0.1, `p90 meal error ${errs[Math.floor(errs.length * 0.9)]}`);
});

test('removals only touch their own meal, and survive "another meal"', () => {
  for (const prefs of PREFS) {
    for (const g of GROUPS) {
      const base = generateDay('2026-11-03', T, prefs, { 0: { reseed: 2 } }, 3, plan(2));
      const meals = generateDay('2026-11-03', T, prefs, { 0: { removed: [g], reseed: 2 } }, 3, plan(2));
      for (let i = 1; i < meals.length; i++) assert.deepEqual(meals[i], base[i], `${prefs.diet}: removing ${g} at breakfast changed ${meals[i].name}`);
      if (meals[0].removable.includes(g)) assert.deepEqual(meals[0].removed, [g]);
    }
  }
});

test('breakfast comes with a fruit, which can be taken out like any group', () => {
  for (const prefs of PREFS) {
    for (let d = 0; d < 7; d++) {
      const [b] = generateDay(addDays('2026-11-01', d), T, prefs, {}, 3, plan(d));
      const fruit = b.items.find((i) => i.slot === 'fruit');
      assert.ok(fruit && FOOD_BY_ID[fruit.foodId].role === 'fruit', `${prefs.diet} breakfast has no fruit`);
      assert.ok(b.removable.includes('fruit'));
      const [nb] = generateDay(addDays('2026-11-01', d), T, prefs, { 0: { removed: ['fruit'] } }, 3, plan(d));
      assert.ok(!nb.items.some((i) => i.slot === 'fruit'));
      assert.ok(Math.abs(nb.totals.kcal - nb.target.kcal) / nb.target.kcal < 0.08);
    }
  }
  for (const diet of ['keto', 'carnivore']) {
    const [b] = generateDay('2026-11-02', { calories: 2000, protein: 150, carbs: 30, fat: 135 }, { ...PREFS[0], diet }, {}, 3, plan(1));
    assert.ok(!b.items.some((i) => FOOD_BY_ID[i.foodId].role === 'fruit'), diet);
  }
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

test('meals stick to foods that belong in them, with one protein where one is enough', () => {
  const plans = [
    { diet: 'omni', kosher: true, allergies: [], dislikes: '', excluded: [], mealsPerDay: 4 },
    { diet: 'omni', kosher: false, allergies: [], dislikes: '', excluded: [], mealsPerDay: 3 },
    { diet: 'omni', kosher: true, allergies: ['gluten', 'dairy'], dislikes: '', excluded: [], mealsPerDay: 5 },
    { diet: 'vegetarian', kosher: true, allergies: [], dislikes: '', excluded: [], mealsPerDay: 4 },
  ];
  let meals = 0;
  let doubles = 0;
  for (const prefs of plans) {
    for (const t of [{ calories: 1600, protein: 125, carbs: 160, fat: 52 }, T, { calories: 3000, protein: 190, carbs: 360, fat: 90 }]) {
      for (let d = 0; d < 14; d++) {
        for (const m of generateDay(addDays('2026-11-01', d), t, prefs, {}, 3, { week: d > 6 ? 1 : 0, dayIndex: d % 7 })) {
          if (prefs.diet === 'omni') meals++;
          // Legume meals (vegetarian) still get a top-up; omnivores rarely need one.
          if (prefs.diet === 'omni' && m.items.filter((i) => i.role === 'protein').length > 1) doubles++;
          for (const it of m.items) {
            const f = FOOD_BY_ID[it.foodId];
            // No steak, chicken or fish dinner for breakfast, no rice or potatoes either.
            if (m.type === 'b' && (['meat', 'poultry'].includes(f.src) && f.id !== 'turkey_pastrami' || ['salmon', 'white_fish', 'trout', 'hake', 'shrimp'].includes(f.id))) assert.fail(`${prefs.diet}: ${f.id} at breakfast`);
            if (m.type === 'b' && f.role === 'carb') assert.ok(f.meals.includes('b'), `${prefs.diet}: ${f.id} at breakfast`);
          }
        }
      }
    }
  }
  assert.ok(doubles / meals < 0.07, `${doubles}/${meals} omnivore meals with two proteins`);
});
