// Weekly check-in schedule, counted from the registration day.
// Week n is due on day 7n after registration (week 0 = registration day itself,
// an optional baseline). From day 7n until the check-in for week n is complete,
// the app is locked.
//
// Pure functions: the clock is passed in, which is what lets the tests (and the
// anti-rollback guard in store.js) control it.

import { dayKey, addDays, daysBetween } from './util.js';

export function weekIndex(regDay, today) {
  return Math.floor(daysBetween(regDay, today) / 7);
}

export function dueDate(regDay, week) {
  return addDays(regDay, week * 7);
}

// checkins: array of { week, completedAt, photoId, ... }
// Returns { week, state: 'none'|'needsPhoto'|'needsMetrics', dueDay, nextDue, daysToNext }
export function gateStatus(regDay, checkins, today = dayKey()) {
  const week = Math.max(0, weekIndex(regDay, today));
  const byWeek = new Map(checkins.map((c) => [c.week, c]));
  const next = week + 1;
  const base = {
    week,
    dueDay: dueDate(regDay, week),
    nextDue: dueDate(regDay, next),
    daysToNext: daysBetween(today, dueDate(regDay, next)),
  };
  if (week < 1) return { ...base, state: 'none' };
  const c = byWeek.get(week);
  if (!c || !c.photoId) return { ...base, state: 'needsPhoto' };
  if (!c.completedAt) return { ...base, state: 'needsMetrics' };
  return { ...base, state: 'none' };
}

// One slot per week from 0 to the current week, filled or empty — the gallery
// shows missed weeks as empty instead of hiding them.
export function weekSlots(regDay, checkins, today = dayKey()) {
  const week = Math.max(0, weekIndex(regDay, today));
  const byWeek = new Map(checkins.map((c) => [c.week, c]));
  const slots = [];
  for (let w = 0; w <= week; w++) {
    const c = byWeek.get(w);
    slots.push({ week: w, date: dueDate(regDay, w), checkin: c && c.photoId ? c : null });
  }
  return slots;
}
