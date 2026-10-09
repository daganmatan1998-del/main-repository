import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bmrMifflin, bmrKatch, energy, computeTargets, assessGoal, macros, LIMITS } from '../../www/js/nutrition.js';
import { gateStatus, weekSlots, weekIndex } from '../../www/js/schedule.js';
import { generateDay } from '../../www/js/mealplan.js';
import { alternatives } from '../../www/js/substitutions.js';
import { FOODS, FOOD_BY_ID, isAllowed, household, ALLERGENS } from '../../www/js/foods.js';
import { addDays } from '../../www/js/util.js';

const man = { sex: 'male', age: 30, height: 180, activity: 'light', workouts: 4 };
const woman = { sex: 'female', age: 35, height: 160, activity: 'sedentary', workouts: 0 };

test('BMR formulas match published equations', () => {
  assert.equal(bmrMifflin({ sex: 'male', age: 30, height: 180, weight: 80 }), 1780);
  assert.equal(bmrMifflin({ sex: 'female', age: 30, height: 165, weight: 60 }), 1320.25);
  assert.equal(Math.round(bmrKatch(80, 20)), 1752);
  assert.equal(energy(man, 80, 20).method, 'Katch-McArdle');
  assert.equal(energy(man, 80, null).method, 'Mifflin-St Jeor');
});

test('cut is capped at the safe weekly rate and never below the floor', () => {
  const period = { goal: 'cut', endDate: addDays('2026-01-01', 28), targetWeight: 70 }; // 10 kg in 4 weeks
  const t = computeTargets(man, period, { weight: 80, bf: 20 }, '2026-01-01');
  assert.ok(t.capped, 'aggressive target is capped');
  assert.ok(Math.abs(t.plannedKgPerWeek) <= 80 * LIMITS.cutMaxPctPerWeek / 100 + 0.01);
  assert.ok(t.calories >= Math.max(1500, t.bmr));
  const small = computeTargets(woman, { goal: 'cut', endDate: addDays('2026-01-01', 14), targetWeight: 40 }, { weight: 50, bf: 28 }, '2026-01-01');
  assert.ok(small.calories >= 1200 && small.calories >= small.bmr - 10, 'calorie floor');
  assert.ok(small.floorApplied || small.capped);
});

test('bulk surplus is limited', () => {
  const t = computeTargets(man, { goal: 'bulk', endDate: addDays('2026-01-01', 28), targetWeight: 90 }, { weight: 75, bf: 14 }, '2026-01-01');
  assert.ok(t.deltaKcal > 0 && t.deltaKcal <= LIMITS.maxSurplus + 10);
  assert.ok(t.capped);
});

test('reaching the target switches to maintenance', () => {
  const t = computeTargets(man, { goal: 'cut', endDate: addDays('2026-01-01', 28), targetWeight: 80 }, { weight: 79, bf: 15 }, '2026-01-01');
  assert.ok(t.reached);
  assert.equal(t.deltaKcal, Math.round(t.calories - t.tdee));
  assert.ok(Math.abs(t.deltaKcal) <= 10);
});

test('macros add up to calories', () => {
  for (const goal of ['cut', 'maintain', 'bulk']) {
    for (const kcal of [1200, 1800, 2600, 3400]) {
      const m = macros(goal, kcal, 75, 20);
      const sum = m.protein * 4 + m.carbs * 4 + m.fat * 9;
      assert.ok(Math.abs(sum - kcal) <= 25, `${goal} ${kcal}: ${sum}`);
      assert.ok(m.protein >= 75 * 1.4 - 5);
    }
  }
});

test('goal assessment flags unrealistic and unsafe targets with a suggestion', () => {
  const a = assessGoal({ goal: 'cut', weeks: 4, weight: 90, bf: 25, targetWeight: 80, targetBf: 18, sex: 'male', height: 180 });
  assert.equal(a.level, 'warn');
  assert.ok(a.suggestion.weeks > 4);
  assert.ok(a.suggestion.targetWeight > 80);
  assert.equal(assessGoal({ goal: 'cut', weeks: 8, weight: 80, bf: 20, targetWeight: 85, targetBf: 15, sex: 'male', height: 180 }).level, 'error');
  assert.equal(assessGoal({ goal: 'cut', weeks: 52, weight: 55, bf: 25, targetWeight: 45, targetBf: 20, sex: 'female', height: 170 }).level, 'error', 'BMI floor');
  assert.equal(assessGoal({ goal: 'cut', weeks: 12, weight: 80, bf: 12, targetWeight: 77, targetBf: 4, sex: 'male', height: 180 }).level, 'error', 'bf floor');
  assert.equal(assessGoal({ goal: 'cut', weeks: 12, weight: 80, bf: 20, targetWeight: 76, targetBf: 17.5, sex: 'male', height: 180 }).level, 'ok');
});

test('weekly gate: due from day 7n, needs photo then metrics', () => {
  const reg = '2026-03-01';
  assert.equal(gateStatus(reg, [], '2026-03-07').state, 'none');
  assert.equal(gateStatus(reg, [], '2026-03-08').state, 'needsPhoto');
  assert.equal(gateStatus(reg, [{ week: 1, photoId: 'x' }], '2026-03-08').state, 'needsMetrics');
  assert.equal(gateStatus(reg, [{ week: 1, photoId: 'x', completedAt: 1 }], '2026-03-14').state, 'none');
  // Missed week 2: only the current week (3) is required.
  const g = gateStatus(reg, [{ week: 1, photoId: 'x', completedAt: 1 }], '2026-03-22');
  assert.equal(g.week, 3);
  assert.equal(g.state, 'needsPhoto');
  const slots = weekSlots(reg, [{ week: 0, photoId: 'a', completedAt: 1 }, { week: 1, photoId: 'x', completedAt: 1 }, { week: 3, photoId: 'z', completedAt: 1 }], '2026-03-22');
  assert.deepEqual(slots.map((s) => !!s.checkin), [true, true, false, true]);
  // DST change (Israel, late March) does not shift weeks.
  assert.equal(weekIndex('2026-03-20', '2026-03-27'), 1);
  assert.equal(weekIndex('2026-03-20', '2026-03-26'), 0);
});

const PREFS = [
  { diet: 'omni', kosher: false, allergies: [], dislikes: '', mealsPerDay: 3 },
  { diet: 'omni', kosher: true, allergies: ['gluten'], dislikes: 'סלמון, בטטה', mealsPerDay: 4 },
  { diet: 'pescatarian', kosher: true, allergies: ['dairy'], dislikes: '', mealsPerDay: 5 },
  { diet: 'vegetarian', kosher: true, allergies: ['treenut', 'peanut'], dislikes: 'טונה', mealsPerDay: 5 },
  { diet: 'vegan', kosher: false, allergies: ['soy', 'gluten'], dislikes: '', mealsPerDay: 6 },
  { diet: 'vegan', kosher: true, allergies: ['sesame'], dislikes: 'עדשים', mealsPerDay: 4 },
];

test('meal plans respect every restriction and land near the targets', () => {
  const targets = computeTargets(man, { goal: 'cut', endDate: '2026-06-01', targetWeight: 74 }, { weight: 80, bf: 20 }, '2026-04-01');
  for (const prefs of PREFS) {
    for (let d = 0; d < 21; d++) {
      const day = generateDay(addDays('2026-04-01', d), targets, prefs, {}, 42);
      assert.equal(day.length, prefs.mealsPerDay);
      let kcal = 0;
      let p = 0;
      for (const meal of day) {
        const foods = meal.items.map((i) => FOOD_BY_ID[i.foodId]);
        for (const f of foods) assert.ok(isAllowed(f, prefs), `${f.id} not allowed for ${JSON.stringify(prefs)}`);
        if (prefs.kosher) {
          assert.ok(!(foods.some((f) => f.kosher === 'meat') && foods.some((f) => f.kosher === 'dairy')), `meat+dairy in ${meal.name}`);
        }
        assert.ok(meal.items.every((i) => i.grams > 0));
        kcal += meal.totals.kcal;
        p += meal.totals.p;
      }
      assert.ok(Math.abs(kcal - targets.calories) / targets.calories < 0.1, `${prefs.diet} kcal ${kcal} vs ${targets.calories}`);
      assert.ok(p >= targets.protein * 0.85, `${prefs.diet} protein ${p} vs ${targets.protein}`);
    }
  }
});

test('plans vary across days and are stable for the same day', () => {
  const t = { calories: 2200, protein: 160, carbs: 230, fat: 70 };
  const prefs = PREFS[0];
  const a = JSON.stringify(generateDay('2026-05-01', t, prefs, {}, 7));
  assert.equal(a, JSON.stringify(generateDay('2026-05-01', t, prefs, {}, 7)));
  const proteins = new Set();
  for (let d = 0; d < 7; d++) generateDay(addDays('2026-05-01', d), t, prefs, {}, 7).forEach((m) => proteins.add(m.items[0].foodId));
  assert.ok(proteins.size >= 5, `variety: ${[...proteins]}`);
});

test('substitutions match the item macro and respect restrictions', () => {
  const prefs = { diet: 'vegetarian', kosher: true, allergies: ['gluten'], dislikes: '', mealsPerDay: 4 };
  const meal = { type: 'l', items: [{ slot: 'protein', foodId: 'eggs', grams: 165 }, { slot: 'carb', foodId: 'white_rice', grams: 150 }] };
  const res = alternatives(meal.items[1], meal, prefs);
  assert.ok(res.options.length >= 3);
  const carbs = FOOD_BY_ID.white_rice.c * 1.5;
  for (const o of res.options) {
    const f = FOOD_BY_ID[o.foodId];
    assert.ok(isAllowed(f, prefs));
    assert.equal(f.role, 'carb');
    assert.ok(Math.abs(o.c - carbs) / carbs < 0.15, `${o.foodId} carbs ${o.c} vs ${carbs}`);
    assert.ok(!f.allergens.includes('gluten'));
  }
  const kosherMeal = { type: 'd', items: [{ slot: 'protein', foodId: 'chicken_breast', grams: 150 }, { slot: 'fat', foodId: 'olive_oil', grams: 10 }] };
  const prot = alternatives(kosherMeal.items[0], kosherMeal, { diet: 'omni', kosher: true, allergies: [], dislikes: '' });
  assert.ok(prot.options.every((o) => FOOD_BY_ID[o.foodId].role === 'protein'));
  const fat = alternatives(kosherMeal.items[1], kosherMeal, { diet: 'omni', kosher: true, allergies: [], dislikes: '' });
  assert.ok(fat.options.every((o) => FOOD_BY_ID[o.foodId].kosher !== 'dairy'));
});

test('household measures read naturally', () => {
  assert.equal(household(FOOD_BY_ID.eggs, 110), '2 ביצים (L)');
  assert.equal(household(FOOD_BY_ID.white_rice, 160), '1 כוס');
  assert.equal(household(FOOD_BY_ID.white_rice, 240), '1½ כוסות');
  assert.equal(household(FOOD_BY_ID.olive_oil, 5), '1 כפית');
  assert.ok(FOODS.every((f) => f.units.length && f.kcal > 0));
  assert.ok(FOODS.every((f) => f.allergens.every((a) => ALLERGENS.some((x) => x.id === a))));
  // Energy from macros roughly matches the stated kcal for every food.
  for (const f of FOODS) {
    const est = f.p * 4 + f.c * 4 + f.f * 9;
    assert.ok(Math.abs(est - f.kcal) / f.kcal < 0.2, `${f.id}: ${est} vs ${f.kcal}`);
  }
});
