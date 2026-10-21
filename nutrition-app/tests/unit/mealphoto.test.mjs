import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromEstimate, fromFood, custom, rename, withGrams, totalsOf, compareToPlan, record } from '../../www/js/mealphoto.js';
import { FOOD_BY_ID } from '../../www/js/foods.js';

const meal = {
  items: [
    { foodId: 'chicken_breast', grams: 150, kcal: 248 },
    { foodId: 'white_rice', grams: 180, kcal: 234 },
    { foodId: 'salad', grams: 200, kcal: 40 },
  ],
};

test('items the app knows are computed from its food table; others keep the estimate per gram', () => {
  const chicken = fromEstimate({ name: 'עוף צלוי', grams: 150, kcal: 999, p: 0, c: 0, f: 0, foodId: 'chicken_breast', confidence: 'high' });
  assert.equal(chicken.name, FOOD_BY_ID.chicken_breast.name);
  assert.equal(chicken.kcal, Math.round(165 * 1.5));
  assert.equal(chicken.seen, 'עוף צלוי');
  const sauce = fromEstimate({ name: 'רוטב', grams: 40, kcal: 120, p: 1, c: 4, f: 11, foodId: '', confidence: 'low' });
  assert.equal(withGrams(sauce, 80).kcal, 240, 'doubling the grams doubles the calories');
  assert.equal(withGrams(sauce, 80).f, 22);
});

test('renaming to a known food switches to its values; other names keep the numbers', () => {
  const x = fromEstimate({ name: 'משהו לבן', grams: 100, kcal: 200, p: 2, c: 40, f: 1, foodId: '', confidence: 'low' });
  const rice = rename(x, FOOD_BY_ID.white_rice.name);
  assert.equal(rice.foodId, 'white_rice');
  assert.equal(rice.kcal, 130);
  const renamed = rename(rice, 'אורז בסמטי');
  assert.equal(renamed.foodId, '');
  assert.equal(renamed.kcal, 130);
  const mine = custom('עוגה', 80, 400);
  assert.equal(mine.kcal, 320);
  assert.equal(fromFood('olive_oil', 10).kcal, 88);
});

test('the planned meal matches; extras, missing foods or a calorie gap do not', () => {
  const same = [fromFood('chicken_breast', 150), fromFood('white_rice', 180), fromFood('salad', 200)];
  assert.equal(compareToPlan(meal, same).matches, true);
  const lemon = custom('לימון', 10, 30); // 3 kcal: too small to count as a different meal
  assert.equal(compareToPlan(meal, [...same, lemon]).matches, true);

  const withSauce = [...same, custom('רוטב שום', 30, 450)];
  const a = compareToPlan(meal, withSauce);
  assert.equal(a.matches, false);
  assert.deepEqual(a.extra, ['רוטב שום']);

  const noRice = [same[0], same[2]];
  const b = compareToPlan(meal, noRice);
  assert.equal(b.matches, false);
  assert.deepEqual(b.missing, [FOOD_BY_ID.white_rice.name]);

  const double = [fromFood('chicken_breast', 300), fromFood('white_rice', 360), fromFood('salad', 200)];
  assert.equal(compareToPlan(meal, double).matches, false, 'twice the portion is not the planned meal');
});

test('the saved record is the edited list with its totals', () => {
  const items = [fromFood('chicken_breast', 100), custom('רוטב', 20, 500)];
  const r = record(items, { replace: true, confidence: 'medium' });
  assert.equal(r.replace, true);
  assert.deepEqual(r.totals, totalsOf(items));
  assert.equal(r.totals.kcal, 165 + 100);
  assert.deepEqual(Object.keys(r.items[0]).sort(), ['c', 'f', 'foodId', 'grams', 'kcal', 'name', 'p']);
});
