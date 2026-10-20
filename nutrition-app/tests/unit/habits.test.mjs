import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as hb from '../../www/js/habits.js';
import { dayMicros, mealMicros, hasMicros } from '../../www/js/micros.js';
import { FOODS } from '../../www/js/foods.js';
import { EVERYDAY } from '../../www/js/everyday.js';
import { EXTRA_BY_ID } from '../../www/js/extras.js';
import { makeCustom } from '../../www/js/everyday.js';

const H = 3600 * 1000;

test('water: goal in glasses, never below one, counts are clamped', () => {
  assert.equal(hb.waterGoal(2), 8);
  assert.equal(hb.waterGoal(2.75), 11);
  assert.equal(hb.waterGoal(0), 8, 'unknown liters fall back to 2');
  assert.equal(hb.glasses({ water: 5 }), 5);
  assert.equal(hb.glasses({ water: -3 }), 0);
  assert.equal(hb.glasses({ water: 999 }), hb.MAX_GLASSES);
  assert.equal(hb.glasses(undefined), 0);
});

test('fasting: running state, reaching the goal, ending and history', () => {
  const now = 1_000_000_000_000;
  assert.equal(hb.fastState(null, now).on, false);
  const f = hb.startFast(null, '16:8', now, now - 10 * H);
  let st = hb.fastState(f, now);
  assert.equal(st.on, true);
  assert.equal(st.reached, false);
  assert.equal(Math.round(st.remaining / H), 6);
  assert.equal(hb.clock(st.elapsed), '10:00');
  const ended = hb.endFast(f, now);
  assert.equal(ended.done, false);
  assert.equal(ended.fast.startedAt, null);
  assert.equal(ended.fast.history.length, 1);
  assert.equal(hb.fastsDone(ended.fast), 0);
  const f2 = hb.startFast(ended.fast, '14:10', now, now - 15 * H);
  assert.equal(hb.fastState(f2, now).reached, true);
  const e2 = hb.endFast(f2, now);
  assert.equal(e2.done, true);
  assert.equal(hb.fastsDone(e2.fast), 1);
  assert.equal(e2.fast.history.length, 2, 'history keeps earlier fasts');
});

test('fasting: a start in the future or days ago is brought into range; unknown plans fall back', () => {
  const now = 1_000_000_000_000;
  assert.equal(hb.startFast(null, '16:8', now, now + 5 * H).startedAt, now);
  assert.equal(hb.startFast(null, '16:8', now, now - 90 * H).startedAt, now - hb.MAX_FAST_HOURS * H);
  assert.equal(hb.startFast(null, 'nonsense', now).protocol, hb.DEFAULT_PROTOCOL);
  assert.equal(hb.endFast({ startedAt: null }, now).done, false);
  const many = hb.startFast({ history: Array.from({ length: 80 }, (_, i) => ({ start: i, end: i + 1, hours: 1, done: false })) }, '16:8', now);
  assert.equal(hb.endFast(many, now + H).fast.history.length, 60);
});

test('streak: counts back from today, or from yesterday while today is empty', () => {
  const k = (...d) => Object.fromEntries(d.map((x) => [x, { eaten: [0] }]));
  assert.equal(hb.streak(k('2026-10-18', '2026-10-19', '2026-10-20'), '2026-10-20'), 3);
  assert.equal(hb.streak(k('2026-10-18', '2026-10-19'), '2026-10-20'), 2, "today isn't over yet");
  assert.equal(hb.streak(k('2026-10-17', '2026-10-19', '2026-10-20'), '2026-10-20'), 2, 'a gap breaks it');
  assert.equal(hb.streak({ '2026-10-20': { eaten: [] } }, '2026-10-20'), 0);
  assert.equal(hb.streak({}, '2026-10-20'), 0);
  assert.equal(hb.longestRun(k('2026-10-01', '2026-10-02', '2026-10-03', '2026-10-10', '2026-10-11')), 3);
  assert.equal(hb.longestRun(k('2026-02-27', '2026-02-28', '2026-03-01')), 3, 'across a month end');
});

test('workouts: calories from MET, weight and minutes; entries are clamped; credit is half', () => {
  assert.equal(hb.burn(9, 70, 30), 315);
  const w = hb.makeWorkout('run', 30, 80);
  assert.deepEqual(w, { type: 'run', min: 30, kcal: 360 });
  assert.equal(hb.makeWorkout('???', 0, 70).type, 'other');
  assert.equal(hb.makeWorkout('walk', 99999, 70).min, hb.MAX_MINUTES);
  assert.equal(hb.makeWorkout('walk', 10, undefined).kcal, hb.burn(3.5, 70, 10));
  const a = hb.dayActivity({ steps: 4321.6, workouts: [w, hb.makeWorkout('yoga', 60, 80)] });
  assert.equal(a.steps, 4322);
  assert.equal(a.kcal, 360 + 200);
  assert.equal(a.credit, 280);
  assert.deepEqual(hb.dayActivity(undefined), { steps: 0, workouts: [], kcal: 0, credit: 0 });
});

test('badges: earned once, from the data, and never twice', () => {
  const logs = {};
  for (let d = 1; d <= 7; d++) logs[`2026-10-${String(d).padStart(2, '0')}`] = { eaten: [0], full: d <= 2, waterDone: true, steps: d === 3 ? 12000 : 0, workouts: d === 4 ? [{ type: 'run', min: 30, kcal: 300 }] : [] };
  const s = hb.statsFrom(logs, { fast: { history: [{ done: true }] }, bestStreak: 0 }, '2026-10-07', 1);
  assert.equal(s.streak, 7);
  assert.equal(s.fullDays, 2);
  assert.equal(s.waterDays, 7);
  assert.equal(s.fasts, 1);
  assert.equal(s.workouts, 1);
  assert.equal(s.bigStepDays, 1);
  const first = hb.newBadges(s, {});
  for (const id of ['streak3', 'streak7', 'full1', 'water1', 'water7', 'fast1', 'move1', 'steps', 'win1']) assert.ok(first.includes(id), id);
  for (const id of ['streak14', 'streak30', 'full7', 'fast10', 'move10', 'win5']) assert.ok(!first.includes(id), id);
  assert.deepEqual(hb.newBadges(s, Object.fromEntries(first.map((i) => [i, '2026-10-07']))), []);
  assert.equal(hb.statsFrom({}, { bestStreak: 12 }, '2026-10-07').best, 12, 'the stored best survives pruned logs');
  assert.equal(new Set(hb.BADGES.map((b) => b.id)).size, hb.BADGES.length);
});

test('micros: every food, everyday food and sauce has a row, and the rows are sane', () => {
  const missing = [...FOODS, ...EVERYDAY, ...Object.values(EXTRA_BY_ID)].filter((f) => !hasMicros(f.id)).map((f) => f.id);
  assert.deepEqual(missing, []);
  // 100 g of a food never has more fiber or sugar than carbs (plus rounding), or an absurd sodium.
  for (const f of [...FOODS, ...EVERYDAY]) {
    const m = mealMicros({ items: [{ foodId: f.id, grams: 100 }], extras: [], custom: [] });
    if (!FOODS.includes(f)) continue;
    assert.ok(m.fiber <= f.c + 0.6, `${f.id} fiber ${m.fiber} vs carbs ${f.c}`);
    assert.ok(m.sugar <= f.c + 0.6, `${f.id} sugar ${m.sugar} vs carbs ${f.c}`);
    assert.ok(m.sodium < 12000);
  }
});

test('micros: items, sauces and the common/typed/scanned own foods are added up', () => {
  const day = dayMicros([
    { index: 0, items: [{ foodId: 'chicken_breast', grams: 150 }, { foodId: 'white_rice', grams: 200 }], extras: [], custom: [{ ref: 'fries', servings: 1 }] },
    { index: 1, items: [], extras: [], custom: [{ name: 'Typed', kcal: 100 }] },
    { index: 2, items: [{ foodId: 'broccoli', grams: 100 }], extras: [], custom: [] },
  ], new Set([0, 1]));
  assert.equal(day.known, false, 'a typed food has no data, so the totals are a lower bound');
  assert.ok(day.fiber > 3 && day.sodium > 300);
  const scanned = makeCustom({ name: 'Cereal', kcal: 100, fi: 3.2, su: 8, na: 150 });
  assert.deepEqual([scanned.fi, scanned.su, scanned.na], [3.2, 8, 150]);
  const s = mealMicros({ items: [], extras: [], custom: [scanned] });
  assert.equal(s.known, true);
  assert.equal(s.sodium, 150);
  assert.equal(makeCustom({ name: 'x', kcal: 1, fi: -4, na: 1e9 }).fi, 0, 'negatives and absurd values are clamped');
  assert.equal(makeCustom({ name: 'x', kcal: 1, na: 1e9 }).na, 20000);
  assert.equal(makeCustom({ name: 'x', kcal: 1 }).fi, undefined);
  assert.equal(mealMicros({ eaten: { totals: {} }, items: [{ foodId: 'tuna', grams: 100 }] }).known, false, 'a photographed meal has no data');
  assert.equal(dayMicros([], undefined).any, false);
});

test('titles: by days tracked, with the next one and progress', () => {
  assert.equal(hb.levelForDays(0), 0);
  assert.equal(hb.levelForDays(2), 0);
  assert.equal(hb.levelForDays(3), 1);
  assert.equal(hb.levelForDays(99), 4);
  assert.equal(hb.levelForDays(365), hb.MAX_LEVEL);
  assert.equal(hb.levelForDays(9999), hb.MAX_LEVEL);
  assert.equal(hb.levelInfo(99).level, hb.MAX_LEVEL, 'out-of-range levels are clamped');
  assert.equal(hb.levelInfo('x').level, 0);
  const n = hb.nextLevel(20, 2);
  assert.equal(n.next.level, 3);
  assert.equal(n.left, 5);
  assert.equal(Math.round(n.pct * 100), 67);
  assert.equal(hb.nextLevel(400, hb.MAX_LEVEL).next, null);
  assert.deepEqual(hb.LEVELS.map((l) => l.level), hb.LEVELS.map((_, i) => i));
  assert.ok(hb.LEVELS.every((l, i) => i === 0 || l.days > hb.LEVELS[i - 1].days));
});

test('days tracked: old days fold into a running total before the logs are pruned, and are never counted twice', () => {
  const k = (...d) => Object.fromEntries(d.map((x) => [x, { eaten: [0] }]));
  const logs = k('2026-08-01', '2026-08-02', '2026-09-30', '2026-10-19', '2026-10-20');
  const today = '2026-10-20';
  assert.equal(hb.lifetimeDays(logs, {}), 5, 'nothing folded yet');
  const fold = hb.foldDays(logs, {}, today);
  assert.equal(fold.daysBase, 2, 'two days are older than 30 days (the cut-off is Sep 20)');
  const settings = { ...fold };
  assert.equal(hb.lifetimeDays(logs, settings), 5, 'same total after folding');
  assert.equal(hb.foldDays(logs, settings, today).daysBase, 2, 'folding again adds nothing');
  const pruned = k('2026-09-30', '2026-10-19', '2026-10-20');
  assert.equal(hb.lifetimeDays(pruned, settings), 5, 'the total survives pruning');
  const later = hb.foldDays({ ...pruned, ...k('2026-10-25') }, settings, '2026-11-26');
  assert.equal(later.daysBase, 6, 'a later fold adds the newly old days');
  assert.equal(hb.lifetimeDays({}, {}), 0);
});
