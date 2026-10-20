// Everyday habits: water glasses, intermittent fasting, streaks and badges,
// steps and workouts. Pure functions over the stored data (state.logs[day],
// settings.fast, settings.badges) so they can be tested without a page.
//
// logs[day]: { eaten, full?, water?, waterDone?, steps?, workouts? }

import { t as tr } from './i18n.js';
import { addDays } from './util.js';

// ---------- water ----------
export const GLASS_ML = 250;
export const MAX_GLASSES = 40;
export const waterGoal = (liters) => Math.max(1, Math.round((Number(liters) || 2) * 1000 / GLASS_ML));
export const glasses = (log) => Math.max(0, Math.min(MAX_GLASSES, Math.round((log && log.water) || 0)));

// ---------- intermittent fasting ----------
export const PROTOCOLS = [
  { id: '14:10', hours: 14 },
  { id: '16:8', hours: 16 },
  { id: '18:6', hours: 18 },
  { id: '20:4', hours: 20 },
];
export const DEFAULT_PROTOCOL = '16:8';
export const MAX_FAST_HOURS = 24;
const HOUR = 3600 * 1000;

export const protocolHours = (id) => (PROTOCOLS.find((p) => p.id === id) || PROTOCOLS[1]).hours;

// fast: { protocol, startedAt (ms | null), history: [{ start, end, hours, done }] }
export function fastState(fast, now) {
  if (!fast || !fast.startedAt) return { on: false };
  const goalMs = protocolHours(fast.protocol) * HOUR;
  const elapsed = Math.max(0, now - fast.startedAt);
  return { on: true, elapsed, goalMs, pct: Math.min(1, elapsed / goalMs), reached: elapsed >= goalMs, remaining: Math.max(0, goalMs - elapsed), endsAt: fast.startedAt + goalMs };
}

export function startFast(fast, protocol, now, startedAt = now) {
  const at = Math.min(now, Math.max(now - MAX_FAST_HOURS * HOUR, Number(startedAt) || now));
  return { history: [], ...(fast || {}), protocol: PROTOCOLS.some((p) => p.id === protocol) ? protocol : DEFAULT_PROTOCOL, startedAt: at };
}

// Ends the running fast; `done` when the goal hours were reached.
export function endFast(fast, now) {
  if (!fast || !fast.startedAt) return { fast, done: false };
  const st = fastState(fast, now);
  const hours = Math.round((st.elapsed / HOUR) * 10) / 10;
  const entry = { start: fast.startedAt, end: now, hours, done: st.reached };
  return { fast: { ...fast, startedAt: null, history: [...(fast.history || []), entry].slice(-60) }, done: st.reached };
}

export const fastsDone = (fast) => ((fast && fast.history) || []).filter((e) => e.done).length;

// "13:05" style, for the elapsed / remaining time.
export function clock(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

// ---------- streaks ----------
// A day counts when at least one planned meal was marked as eaten.
export const kept = (log) => !!(log && log.eaten && log.eaten.length);

export function streak(logs, todayKey) {
  let d = todayKey;
  if (!kept(logs[d])) d = addDays(d, -1); // today isn't over: yesterday's run still stands
  let n = 0;
  while (kept(logs[d])) { n++; d = addDays(d, -1); }
  return n;
}

export function longestRun(logs) {
  const days = Object.keys(logs).filter((d) => kept(logs[d])).sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of days) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

// ---------- steps and workouts ----------
export const STEP_GOAL = 8000;
export const MAX_STEPS = 100000;
// Estimates run high, so only half of the burned calories are given back.
export const ACTIVITY_CREDIT = 0.5;

export const WORKOUTS = [
  { id: 'walk', met: 3.5, name: tr('Walking') },
  { id: 'run', met: 9, name: tr('Running') },
  { id: 'bike', met: 7, name: tr('Cycling') },
  { id: 'swim', met: 6, name: tr('Swimming') },
  { id: 'strength', met: 4.5, name: tr('Strength training') },
  { id: 'hiit', met: 8, name: tr('HIIT') },
  { id: 'yoga', met: 2.5, name: tr('Yoga / stretching') },
  { id: 'ball', met: 7, name: tr('Ball game') },
  { id: 'dance', met: 5, name: tr('Dancing') },
  { id: 'other', met: 4, name: tr('Other workout') },
];
export const WORKOUT_BY_ID = Object.fromEntries(WORKOUTS.map((w) => [w.id, w]));
export const MAX_MINUTES = 300;

export const burn = (met, kg, minutes) => Math.round(met * (Number(kg) || 70) * Math.max(0, minutes) / 60);

export function makeWorkout(type, minutes, kg) {
  const w = WORKOUT_BY_ID[type] || WORKOUT_BY_ID.other;
  const min = Math.max(1, Math.min(MAX_MINUTES, Math.round(Number(minutes) || 0)));
  return { type: w.id, min, kcal: burn(w.met, kg, min) };
}

export function dayActivity(log) {
  const workouts = (log && log.workouts) || [];
  const kcal = workouts.reduce((s, w) => s + (w.kcal || 0), 0);
  return { steps: Math.max(0, Math.round((log && log.steps) || 0)), workouts, kcal, credit: Math.round(kcal * ACTIVITY_CREDIT) };
}

// ---------- badges ----------
// stats: { streak, best, fullDays, waterDays, fasts, workouts, bigStepDays, wins }
export const BADGES = [
  { id: 'streak3', icon: 'flame', name: tr('3-day streak'), desc: tr('Mark your meals 3 days in a row'), ok: (s) => s.best >= 3 },
  { id: 'streak7', icon: 'flame', name: tr('7-day streak'), desc: tr('Mark your meals 7 days in a row'), ok: (s) => s.best >= 7 },
  { id: 'streak14', icon: 'flame', name: tr('14-day streak'), desc: tr('Mark your meals 14 days in a row'), ok: (s) => s.best >= 14 },
  { id: 'streak30', icon: 'flame', name: tr('30-day streak'), desc: tr('Mark your meals 30 days in a row'), ok: (s) => s.best >= 30 },
  { id: 'full1', icon: 'check', name: tr('Perfect day'), desc: tr('Mark every meal of a day'), ok: (s) => s.fullDays >= 1 },
  { id: 'full7', icon: 'check', name: tr('7 perfect days'), desc: tr('Mark every meal on 7 different days'), ok: (s) => s.fullDays >= 7 },
  { id: 'water1', icon: 'drop', name: tr('Hydrated'), desc: tr('Reach your water goal'), ok: (s) => s.waterDays >= 1 },
  { id: 'water7', icon: 'drop', name: tr('Water habit'), desc: tr('Reach your water goal on 7 days'), ok: (s) => s.waterDays >= 7 },
  { id: 'fast1', icon: 'clock', name: tr('First fast'), desc: tr('Finish a fast'), ok: (s) => s.fasts >= 1 },
  { id: 'fast10', icon: 'clock', name: tr('10 fasts'), desc: tr('Finish 10 fasts'), ok: (s) => s.fasts >= 10 },
  { id: 'move1', icon: 'run', name: tr('On the move'), desc: tr('Log a workout'), ok: (s) => s.workouts >= 1 },
  { id: 'move10', icon: 'run', name: tr('10 workouts'), desc: tr('Log 10 workouts'), ok: (s) => s.workouts >= 10 },
  { id: 'steps', icon: 'run', name: tr('10,000 steps'), desc: tr('Log 10,000 steps in a day'), ok: (s) => s.bigStepDays >= 1 },
  { id: 'win1', icon: 'trophy', name: tr('First win'), desc: tr('Win a challenge against a friend'), ok: (s) => s.wins >= 1 },
  { id: 'win5', icon: 'trophy', name: tr('5 wins'), desc: tr('Win 5 challenges against friends'), ok: (s) => s.wins >= 5 },
];

export function statsFrom(logs, settings, todayKey, wins = 0) {
  const days = Object.values(logs || {});
  const run = Math.max(longestRun(logs || {}), (settings && settings.bestStreak) || 0);
  return {
    streak: streak(logs || {}, todayKey),
    best: run,
    fullDays: days.filter((l) => l && l.full).length,
    waterDays: days.filter((l) => l && l.waterDone).length,
    fasts: fastsDone(settings && settings.fast),
    workouts: days.reduce((s, l) => s + ((l && l.workouts) || []).length, 0),
    bigStepDays: days.filter((l) => l && l.steps >= 10000).length,
    wins,
  };
}

// Badges reached now and not yet stored: [id, …].
export function newBadges(stats, have = {}) {
  return BADGES.filter((b) => !have[b.id] && b.ok(stats)).map((b) => b.id);
}
