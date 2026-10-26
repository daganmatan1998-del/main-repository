import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as hb from '../../www/js/habits.js';
import { dayMicros, mealMicros, hasMicros } from '../../www/js/micros.js';
import { FOODS } from '../../www/js/foods.js';
import { EVERYDAY } from '../../www/js/everyday.js';
import { EXTRA_BY_ID } from '../../www/js/extras.js';
import { makeCustom } from '../../www/js/everyday.js';

const H = 3600 * 1000;

test('water: the goal in ml, drinks logged between meals and with each meal add up to the total', () => {
  assert.equal(hb.waterGoalMl(2.5), 2500);
  assert.equal(hb.waterGoalMl(0), 2000, 'unknown litres fall back to 2');
  assert.equal(hb.waterGoalMl(undefined), 2000);
  let log = { eaten: [] };
  log = { ...log, waterAdds: hb.addWater(log, 500, 0) };
  log = { ...log, waterAdds: hb.addWater(log, 1000, 1) };
  log = { ...log, waterAdds: hb.addWater(log, 330, 1) };
  log = { ...log, waterAdds: hb.addWater(log, 250, -1) };
  assert.equal(hb.mealWaterMl(log, 0), 500);
  assert.equal(hb.mealWaterMl(log, 1), 1330);
  assert.equal(hb.mealWaterMl(log, 2), 0);
  assert.equal(hb.looseWaterMl(log), 250);
  assert.equal(hb.waterWithMealsMl(log), 1830);
  assert.equal(hb.waterTotalMl(log), 2080);
  // undo removes the last drink of that meal (or between meals), nothing else
  assert.deepEqual(hb.undoWater(log, 1).map((a) => a.ml), [500, 1000, 250]);
  assert.deepEqual(hb.undoWater(log, -1).map((a) => a.ml), [500, 1000, 330]);
  assert.equal(hb.undoWater(log, 5).length, 4, 'nothing logged for that meal: unchanged');
  assert.equal(hb.undoWater(undefined, -1).length, 0);
});

test('water: bad amounts are refused or capped, and the list stays short', () => {
  assert.equal(hb.addWater({}, 0, -1).length, 0);
  assert.equal(hb.addWater({}, -5, -1).length, 0);
  assert.equal(hb.addWater({}, 'x', -1).length, 0);
  assert.equal(hb.addWater({}, 99999, -1)[0].ml, hb.MAX_ADD_ML);
  let log = {};
  for (let i = 0; i < 100; i++) log = { waterAdds: hb.addWater(log, 100, -1) };
  assert.equal(log.waterAdds.length, hb.MAX_ADDS);
  assert.equal(hb.waterTotalMl(undefined), 0);
});

test('water: what is typed in the free field (ml; a small decimal means litres)', () => {
  assert.equal(hb.parseMl('330'), 330);
  assert.equal(hb.parseMl(' 250 '), 250);
  assert.equal(hb.parseMl('1.5'), 1500);
  assert.equal(hb.parseMl('0,5'), 500);
  assert.equal(hb.parseMl('2'), 2, 'a whole number is millilitres');
  assert.equal(hb.parseMl('99999'), hb.MAX_ADD_ML);
  for (const bad of ['', 'abc', '0', '-3', '  ']) assert.ok(Number.isNaN(hb.parseMl(bad)), bad);
});

test('water: older data in 250 ml glasses is still counted', () => {
  const log = { water: 2, waterMeals: { 0: 1, 2: 2 }, waterAdds: [{ ml: 500, meal: 0 }] };
  assert.equal(hb.looseWaterMl(log), 500);
  assert.equal(hb.mealWaterMl(log, 0), 250 + 500);
  assert.equal(hb.mealWaterMl(log, 2), 500);
  assert.equal(hb.waterWithMealsMl(log), 250 + 500 + 500);
  assert.equal(hb.waterTotalMl(log), 500 + 1250);
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

test('workouts and steps: calories from MET / weight / minutes and from steps; entries are clamped', () => {
  assert.equal(hb.burn(9, 70, 30), 315);
  const w = hb.makeWorkout('run', 30, 80);
  assert.deepEqual(w, { type: 'run', min: 30, kcal: 360 });
  assert.equal(hb.makeWorkout('???', 0, 70).type, 'other');
  assert.equal(hb.makeWorkout('walk', 99999, 70).min, hb.MAX_MINUTES);
  assert.equal(hb.makeWorkout('walk', 10, undefined).kcal, hb.burn(3.5, 70, 10));
  const a = hb.dayActivity({ steps: 4321.6, workouts: [w, hb.makeWorkout('yoga', 60, 80)] }, 80);
  assert.equal(a.steps, 4322);
  assert.equal(a.workoutKcal, 360 + 200);
  assert.equal(a.stepsKcal, hb.stepKcal(4322, 80));
  assert.equal(a.kcal, a.workoutKcal + a.stepsKcal);
  assert.equal(a.credit, a.kcal, 'everything burned goes back into the budget');
  assert.deepEqual(hb.dayActivity(undefined), { steps: 0, stepsKcal: 0, workouts: [], workoutKcal: 0, kcal: 0, credit: 0 });
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

test('emblems: reached by the best streak, the next one and the progress', () => {
  assert.deepEqual(hb.EMBLEMS.map((e) => e.days), [5, 10, 20, 25, 50, 100]);
  assert.deepEqual(hb.emblemsEarned(4), []);
  assert.deepEqual(hb.emblemsEarned(5), [1]);
  assert.deepEqual(hb.emblemsEarned(25), [1, 2, 3, 4]);
  assert.equal(hb.emblemsEarned(100).length, 6);
  assert.equal(hb.emblemInfo(3).days, 20);
  assert.equal(hb.emblemInfo(0), null);
  assert.equal(hb.emblemInfo(99), null);
  const n = hb.nextEmblem(7);
  assert.equal(n.next.id, 2);
  assert.equal(n.left, 3);
  assert.equal(Math.round(n.pct * 100), 40);
  assert.equal(hb.nextEmblem(100).next, null);
  assert.equal(hb.nextEmblem(0).left, 5);
});

test('streak run: carried across days, past the 60 days the logs keep, and survives an unmarked meal', () => {
  const k = (...d) => Object.fromEntries(d.map((x) => [x, { eaten: [0] }]));
  assert.deepEqual(hb.advanceRun({}, {}, '2026-10-20'), { runLen: 0, runEnd: '' });
  assert.deepEqual(hb.advanceRun(k('2026-10-20'), {}, '2026-10-20'), { runLen: 1, runEnd: '2026-10-20' });
  // the next day the run grows by one even though the logs only show a short window
  const day2 = hb.advanceRun(k('2026-10-19', '2026-10-20', '2026-10-21'), { runLen: 90, runEnd: '2026-10-20' }, '2026-10-21');
  assert.deepEqual(day2, { runLen: 91, runEnd: '2026-10-21' });
  // a missed day in between ends it
  assert.equal(hb.advanceRun(k('2026-10-21'), { runLen: 90, runEnd: '2026-10-19' }, '2026-10-21').runLen, 1);
  // today still empty: yesterday's run stands
  assert.equal(hb.advanceRun(k('2026-10-20'), { runLen: 90, runEnd: '2026-10-20' }, '2026-10-21').runLen, 90);
  // today's only meal was marked (run 91 stored) and then unmarked
  assert.equal(hb.advanceRun(k('2026-10-20'), { runLen: 91, runEnd: '2026-10-21' }, '2026-10-21').runLen, 90);
  // a whole window of 60 days with no stored run
  const logs = {};
  for (let i = 0; i < 60; i++) logs[new Date(Date.UTC(2026, 9, 20) - i * 86400000).toISOString().slice(0, 10)] = { eaten: [0] };
  assert.equal(hb.advanceRun(logs, {}, '2026-10-20').runLen, 60);
  const s = hb.statsFrom(k('2026-10-20'), { runLen: 99, runEnd: '2026-10-19', bestStreak: 99 }, '2026-10-20');
  assert.equal(s.streak, 100);
  assert.equal(s.best, 100);
  assert.deepEqual(hb.emblemsEarned(s.best).length, 6);
});

test('steps: 8000 steps burn about 300-500 kcal depending on weight', () => {
  assert.equal(hb.stepKcal(0, 70), 0);
  assert.equal(hb.stepKcal(-5, 70), 0);
  assert.equal(hb.stepKcal('x', 70), 0);
  assert.ok(hb.stepKcal(8000, 60) >= 280 && hb.stepKcal(8000, 60) <= 340, String(hb.stepKcal(8000, 60)));
  assert.ok(hb.stepKcal(8000, 70) >= 330 && hb.stepKcal(8000, 70) <= 400, String(hb.stepKcal(8000, 70)));
  assert.ok(hb.stepKcal(8000, 90) >= 420 && hb.stepKcal(8000, 90) <= 500, String(hb.stepKcal(8000, 90)));
  assert.equal(hb.stepKcal(8000), hb.stepKcal(8000, 70), 'unknown weight: 70 kg');
  assert.ok(Math.abs(hb.stepKcal(16000, 70) - 2 * hb.stepKcal(8000, 70)) <= 1);
});
