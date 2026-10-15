import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extraOptions, extraFood, extraMacros, LIGHT_KCAL, MAX_EXTRAS } from '../../www/js/extras.js';
import { matchDrink, makeDrink, drinkTotals, dayDrinks } from '../../www/js/drinks.js';
import { generateDay } from '../../www/js/mealplan.js';
import { normText } from '../../www/js/util.js';

const targets = { calories: 2000, protein: 150, carbs: 200, fat: 60 };
const prefs = { diet: 'omni', mealsPerDay: 4, allergies: [], dislikes: '', excluded: [] };
const plan = { week: 0, dayIndex: 1 };

test('low-calorie sauces are offered first, then the rest, then cheeses', () => {
  const o = extraOptions(prefs, []);
  const firstHeavy = o.findIndex((x) => !x.light);
  assert.ok(firstHeavy > 5, 'several light sauces first');
  assert.ok(o.slice(0, firstHeavy).every((x) => x.light && x.kcal <= LIGHT_KCAL));
  assert.ok(o.slice(0, firstHeavy).every((x, i, a) => !i || a[i - 1].kcal <= x.kcal), 'lowest calories first');
  assert.equal(o[o.length - 1].group, 'cheese');
  assert.ok(o.some((x) => x.food.id === 'cottage'), "cottage is offered");
});

test('diet, allergies and kosher filter the options', () => {
  assert.ok(!extraOptions({ ...prefs, allergies: ['sesame'] }, []).some((x) => x.food.allergens.includes('sesame')));
  assert.ok(!extraOptions({ ...prefs, diet: 'vegan' }, []).some((x) => ['dairy', 'egg'].includes(x.food.src)));
  assert.ok(!extraOptions({ ...prefs, diet: 'keto' }, []).some((x) => x.food.id === 'x_ketchup'), 'sugary sauce out for keto');
  assert.ok(!extraOptions({ ...prefs, kosher: true }, [{ kosher: 'meat' }]).some((x) => x.food.kosher === 'dairy'), 'no dairy next to meat');
});

test('adding sauces and cheese keeps the meal on its calorie budget', () => {
  const base = generateDay('2026-10-12', targets, prefs, {}, 7, plan);
  for (const extras of [[{ foodId: 'x_tahini_sauce', grams: 30 }], [{ foodId: 'cottage', grams: 100 }, { foodId: 'x_pesto', grams: 15 }]]) {
    const m = generateDay('2026-10-12', targets, prefs, { 0: { extras } }, 7, plan);
    assert.equal(m[0].extras.length, extras.length);
    assert.ok(Math.abs(m[0].totals.kcal - m[0].target.kcal) <= m[0].target.kcal * 0.08, `${m[0].totals.kcal} vs ${m[0].target.kcal}`);
    assert.equal(m[0].items.length, base[0].items.length, 'same foods, smaller portions');
    assert.ok(m[0].totals.kcal - m[0].extras.reduce((s, e) => s + e.kcal, 0) < base[0].items.reduce((s, i) => s + i.kcal, 0) + 1, 'the rest of the meal got smaller');
  }
  assert.deepEqual(generateDay('2026-10-12', targets, prefs, { 0: { extras: [] } }, 7, plan)[0].items, base[0].items, 'no extras: untouched');
  assert.deepEqual(generateDay('2026-10-12', targets, prefs, { 0: { extras: [{ foodId: 'nope', grams: 5 }] } }, 7, plan)[0].extras, [], 'unknown food ignored');
  assert.equal(generateDay('2026-10-12', targets, prefs, { 0: { extras: Array(9).fill({ foodId: 'x_mustard', grams: 5 }) } }, 7, plan)[0].extras.length, MAX_EXTRAS);
});

test('extras do not change the other meals', () => {
  const a = generateDay('2026-10-12', targets, prefs, {}, 7, plan);
  const b = generateDay('2026-10-12', targets, prefs, { 0: { extras: [{ foodId: 'x_hummus', grams: 40 }] } }, 7, plan);
  for (let i = 1; i < a.length; i++) assert.deepEqual(b[i].items, a[i].items);
});

test('extras combine with a removed group', () => {
  const m = generateDay('2026-10-12', targets, prefs, { 2: { removed: ['carb'], extras: [{ foodId: 'x_mustard', grams: 10 }] } }, 7, plan)[2];
  assert.ok(Math.abs(m.totals.kcal - m.target.kcal) <= m.target.kcal * 0.08);
});

test('extraMacros and extraFood', () => {
  assert.equal(extraFood('x_olive_oil').name, 'שמן זית');
  assert.equal(Math.round(extraMacros('x_olive_oil', 5).kcal), 44);
  assert.equal(extraFood('chicken_breast'), null);
});

test('drinks are recognised, longest match wins', () => {
  assert.equal(matchDrink('קפה').name, 'קפה שחור');
  assert.equal(matchDrink('קפה עם חלב').name, 'קפה עם טיפת חלב');
  assert.equal(matchDrink('קולה זירו').name, 'משקה דיאט / זירו');
  assert.equal(matchDrink('שוקו').name, 'שוקו');
  assert.equal(matchDrink('חלב שקדים').name, 'חלב שקדים (לא ממותק)');
  assert.equal(matchDrink('מרק פטריות'), null);
  assert.equal(matchDrink('  '), null);
});

test('drink calories: cups × (drink + sugar)', () => {
  assert.equal(drinkTotals(makeDrink({ text: 'שוקו', sugar: 2, count: 2 })).kcal, 404);
  assert.equal(drinkTotals(makeDrink({ text: 'קפה שחור', sugar: 3 })).kcal, 51);
  assert.equal(drinkTotals(makeDrink({ text: 'מים' })).kcal, 0);
  const unknown = makeDrink({ text: 'מרק פטריות' });
  assert.equal(unknown.unknown, true);
  assert.equal(drinkTotals({ ...unknown, kcalCup: 50 }).kcal, 50, 'the person can say the calories');
  assert.equal(makeDrink({ text: 'מים', count: 'x' }).count, 1, 'bad numbers fall back');
  assert.equal(makeDrink({ text: 'מים', sugar: -4 }).sugar, 0);
});

test('a day\'s drinks add up across meals', () => {
  const d1 = makeDrink({ text: 'קולה' });
  const d2 = makeDrink({ text: 'שוקו' });
  assert.equal(dayDrinks({ drinks: { 0: [d1], 2: [d2] } }).kcal, 105 + 170);
  assert.equal(dayDrinks(undefined).kcal, 0);
});

test('search text ignores quotes, geresh and case', () => {
  assert.equal(normText("קוטג'"), normText('קוטג'));
  assert.equal(normText('סריראצ׳ה'), normText('סריראצה'));
  assert.equal(normText('Whey  Protein'), 'whey protein');
});
