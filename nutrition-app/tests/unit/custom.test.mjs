import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVERYDAY, EVERYDAY_BY_ID, everydayOptions, makeCustom, withServings, customValid, MAX_CUSTOM } from '../../www/js/everyday.js';
import { generateDay } from '../../www/js/mealplan.js';

const targets = { calories: 2000, protein: 150, carbs: 200, fat: 60 };
const prefs = { diet: 'omni', mealsPerDay: 4, allergies: [], dislikes: '', excluded: [] };
const plan = { week: 0, dayIndex: 1 };
const day = (custom, idx = 1) => generateDay('2026-10-12', targets, prefs, { [idx]: { custom } }, 7, plan)[idx];
const base = day([]);

test('the everyday foods are sane: unique ids, numbers add up, a serving unit each', () => {
  assert.ok(EVERYDAY.length >= 50);
  assert.equal(new Set(EVERYDAY.map((f) => f.id)).size, EVERYDAY.length);
  for (const f of EVERYDAY) {
    const kcal = 4 * f.p + 4 * f.c + 9 * f.f;
    assert.ok(Math.abs(kcal - f.kcal) <= Math.max(25, f.kcal * 0.12), `${f.id}: ${f.kcal} vs ${Math.round(kcal)}`);
    assert.ok(f.units[0].g > 0 && f.def > 0, f.id);
  }
  for (const id of ['hot_dog', 'fries', 'bamba', 'pizza', 'schnitzel']) assert.ok(EVERYDAY_BY_ID[id], id);
});

test('diet and allergies filter the everyday foods', () => {
  const ids = (p) => everydayOptions({ ...prefs, ...p }).map((o) => o.food.id);
  assert.ok(!ids({ diet: 'vegan' }).includes('hot_dog') && !ids({ diet: 'vegan' }).includes('pizza'));
  assert.ok(ids({ diet: 'vegan' }).includes('fries'));
  assert.ok(!ids({ allergies: ['peanut'] }).includes('bamba'));
  assert.ok(!ids({ diet: 'keto' }).includes('cookies'));
});

test('makeCustom: common foods scale with servings, typed ones are clamped', () => {
  const a = makeCustom({ name: 'Fries', ref: 'fries', servings: 1 });
  assert.equal(a.kcal, Math.round(313 * 1.5));
  assert.equal(withServings(a, 2).kcal, Math.round(313 * 3));
  const t = makeCustom({ name: '  x'.repeat(30), kcal: 99999, p: -5, c: 'abc' });
  assert.equal(t.kcal, 5000);
  assert.ok(t.name.length <= 40 && t.p === 0 && t.c === 0);
  assert.ok(!customValid(makeCustom({ name: 'nothing', kcal: 0 })) && !customValid(makeCustom({ name: '', kcal: 100 })));
});

test('"take off the rest of the meal" keeps the meal on its calories', () => {
  const m = day([makeCustom({ name: 'Cake', kcal: 400, mode: 'offset' })]);
  assert.equal(m.custom.length, 1);
  assert.ok(Math.abs(m.totals.kcal - base.totals.kcal) <= base.totals.kcal * 0.1, `${m.totals.kcal} vs ${base.totals.kcal}`);
  assert.ok(m.items.reduce((s, i) => s + i.kcal, 0) < base.items.reduce((s, i) => s + i.kcal, 0) - 200, 'the plan items got smaller');
});

test('"add on top" raises the meal by exactly those calories', () => {
  const c = makeCustom({ name: 'Fries', ref: 'fries', servings: 1, mode: 'add' });
  const m = day([c]);
  assert.deepEqual(m.items, base.items, 'plan items untouched');
  assert.equal(m.totals.kcal, base.totals.kcal + c.kcal);
});

test('a food that replaces a plan item takes it out of the meal', () => {
  const prot = base.items.find((i) => i.role === 'protein');
  const keep = day([makeCustom({ name: 'Schnitzel', kcal: prot.kcal, mode: 'offset', slot: prot.slot })]);
  assert.ok(!keep.items.some((i) => i.slot === prot.slot));
  assert.ok(Math.abs(keep.totals.kcal - base.totals.kcal) <= base.totals.kcal * 0.1);
  assert.ok(keep.custom[0].replaced && keep.custom[0].p > 0, 'macros borrowed from the replaced item');
  const add = day([makeCustom({ name: 'Schnitzel', kcal: 450, mode: 'add', slot: prot.slot })]);
  assert.equal(add.totals.kcal, base.totals.kcal - prot.kcal + 450);
  // a slot the meal no longer has: it is just an addition
  const lost = day([makeCustom({ name: 'X', kcal: 100, mode: 'add', slot: 'nope' })]);
  assert.equal(lost.items.length, base.items.length);
});

test('invalid entries are ignored and the number is capped', () => {
  assert.deepEqual(day([{ name: 'x', kcal: 0 }, { kcal: 100 }, null].filter(Boolean)).custom, []);
  const many = Array.from({ length: 9 }, (_, i) => makeCustom({ name: `f${i}`, kcal: 50, mode: 'add' }));
  assert.equal(day(many).custom.length, MAX_CUSTOM);
});
