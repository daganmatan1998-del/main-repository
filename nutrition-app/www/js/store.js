// Application state: loaded once from IndexedDB, kept in memory, written through.

import * as db from './db.js';
import { dayKey, addDays, daysBetween } from './util.js';
import { computeTargets, validBf } from './nutrition.js';
import { generateDay } from './mealplan.js';
import { gateStatus, weekSlots, weekIndex } from './schedule.js';

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) fn(); }

export const state = {
  loaded: false,
  profile: null, // { name, sex, age, height, activity, workouts, registeredAt, regDay, seed, prefs }
  periods: [],
  checkins: [],
  metrics: [],
  settings: { theme: 'system', reminders: false, installDismissed: false },
  overrides: {}, // { [day]: { [mealIdx]: { reseed, swaps } } }
  logs: {}, // { [day]: { eaten: number[] } }
  chat: [],
  shopping: {}, // { [menuWeek]: checkedItemIds[] }
  meta: { maxSeen: 0 },
};

export async function load() {
  const [profile, periods, settings, overrides, logs, chat, meta, checkins, metrics, shopping] = await Promise.all([
    db.kv.get('profile'), db.kv.get('periods'), db.kv.get('settings'), db.kv.get('overrides'),
    db.kv.get('logs'), db.kv.get('chat'), db.kv.get('meta'), db.getAll('checkins'), db.getAll('metrics'),
    db.kv.get('shopping'),
  ]);
  state.profile = profile || null;
  state.periods = periods || [];
  state.settings = { ...state.settings, ...(settings || {}) };
  state.overrides = overrides || {};
  state.logs = logs || {};
  state.chat = chat || [];
  state.shopping = shopping || {};
  state.meta = { ...state.meta, ...(meta || {}) };
  state.checkins = checkins || [];
  state.metrics = (metrics || []).sort((a, b) => a.at - b.at);
  state.loaded = true;
}

// ---------- clock with rollback protection ----------
// Setting the device clock back a week must not make a due check-in disappear.
// Small backward jumps (time-zone travel) are tolerated; larger ones are ignored
// and the latest time this device has already seen is used instead.
const ROLLBACK_TOLERANCE_MS = 26 * 3600 * 1000;
let lastPersist = 0;

export function nowMs() {
  const real = Date.now();
  const seen = state.meta.maxSeen || 0;
  if (real > seen) {
    state.meta.maxSeen = real;
    if (real - lastPersist > 60000) {
      lastPersist = real;
      db.kv.set('meta', state.meta).catch(() => {});
    }
    return real;
  }
  return seen - real > ROLLBACK_TOLERANCE_MS ? seen : real;
}

export function today() {
  return dayKey(new Date(nowMs()));
}

// ---------- derived ----------

export const isOnboarded = () => !!(state.profile && state.profile.regDay);

export function currentMetrics() {
  const m = state.metrics[state.metrics.length - 1];
  return m ? { weight: m.weight, bf: m.bf, day: m.day } : null;
}

export function previousMetrics() {
  const m = state.metrics[state.metrics.length - 2];
  return m ? { weight: m.weight, bf: m.bf, day: m.day } : null;
}

export function activePeriod() {
  return state.periods.filter((p) => p.status === 'active').slice(-1)[0] || state.periods[state.periods.length - 1] || null;
}

export function periodEnded(p = activePeriod(), t = today()) {
  return !!p && p.status === 'active' && daysBetween(t, p.endDate) <= 0;
}

export function targets(day = today()) {
  const p = activePeriod();
  const cur = currentMetrics();
  if (!p || !cur) return null;
  return computeTargets(state.profile, p, cur, day);
}

export function dayPlan(day = today()) {
  const t = targets(day);
  if (!t) return [];
  return generateDay(day, t, state.profile.prefs, state.overrides[day] || {}, state.profile.seed || 0,
    { week: menuWeek(day), dayIndex: daysBetween(state.profile.regDay, day) - menuWeek(day) * 7 });
}

// Menu weeks follow the check-in weeks (registration day = start of week 0),
// so each week's food set lines up with one shopping trip.
export function menuWeek(day = today()) {
  return Math.floor(daysBetween(state.profile.regDay, day) / 7);
}

export function menuWeekRange(week) {
  const start = addDays(state.profile.regDay, week * 7);
  return { start, end: addDays(start, 6) };
}

export function gate() {
  if (!isOnboarded()) return { state: 'none', week: 0 };
  return gateStatus(state.profile.regDay, state.checkins, today());
}

export function slots() {
  return weekSlots(state.profile.regDay, state.checkins, today());
}

export function currentWeek() {
  return Math.max(0, weekIndex(state.profile.regDay, today()));
}

// ---------- writes ----------

export async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await db.kv.set('settings', state.settings);
  emit();
}

export async function completeOnboarding({ profile, period, weight, bf, baseline }) {
  const now = new Date(nowMs());
  const regDay = dayKey(now);
  state.profile = { ...profile, registeredAt: now.toISOString(), regDay, seed: Math.floor(Math.random() * 1e9) };
  state.periods = [{ id: 1, ...period, startDate: regDay, endDate: addDays(regDay, period.weeks * 7), startWeight: weight, startBf: bf, status: 'active' }];
  await db.kv.set('profile', state.profile);
  await db.kv.set('periods', state.periods);
  await addMetrics(weight, bf, 'onboarding', false);
  if (baseline) await saveCheckinPhoto(0, baseline, { weight, bf });
  emit();
}

export async function updateProfile(patch) {
  state.profile = { ...state.profile, ...patch, prefs: { ...state.profile.prefs, ...(patch.prefs || {}) } };
  await db.kv.set('profile', state.profile);
  emit();
}

export async function addMetrics(weight, bf, source, notify = true) {
  const entry = { at: nowMs(), day: today(), weight: Number(weight), bf: validBf(bf) ? Number(bf) : null, source };
  const id = await db.put('metrics', entry);
  state.metrics.push({ ...entry, id });
  if (notify) emit();
  return entry;
}

// Step 1 of a check-in: the photo. Stored immediately, so closing the app
// between the two steps resumes at step 2 instead of losing the upload.
// `complete` is set only when weight and body fat are already known (baseline).
export async function saveCheckinPhoto(week, img, complete) {
  const photoId = `w${week}-${Date.now()}`;
  const existing = state.checkins.find((c) => c.week === week);
  const checkin = {
    ...(existing || {}),
    week,
    dueDay: addDays(state.profile.regDay, week * 7),
    photoId,
    photoAt: nowMs(),
    ...(complete ? { weight: complete.weight, bf: complete.bf, completedAt: nowMs() } : {}),
  };
  await db.putPhotoAndCheckin(
    { id: photoId, week, blob: img.blob, width: img.width, height: img.height, type: img.blob.type, createdAt: nowMs() },
    checkin,
  );
  if (existing && existing.photoId && existing.photoId !== photoId) {
    await db.del('photos', existing.photoId).catch(() => {});
  }
  state.checkins = state.checkins.filter((c) => c.week !== week).concat(checkin).sort((a, b) => a.week - b.week);
  emit();
  return checkin;
}

// Step 2: weight + body fat. Returns a before/after summary for the user.
export async function completeCheckin(week, weight, bf) {
  const before = currentMetrics();
  const targetsBefore = targets();
  await addMetrics(weight, bf, 'checkin', false);
  const c = state.checkins.find((x) => x.week === week);
  const updated = { ...c, weight: Number(weight), bf: Number(bf), completedAt: nowMs() };
  await db.put('checkins', updated);
  state.checkins = state.checkins.map((x) => (x.week === week ? updated : x));
  const targetsAfter = targets();
  emit();
  return { before, after: { weight: Number(weight), bf: Number(bf) }, targetsBefore, targetsAfter };
}

export async function setOverride(day, mealIdx, patch) {
  const d = { ...(state.overrides[day] || {}) };
  const m = { ...(d[mealIdx] || {}) };
  if (patch.reseed !== undefined) { m.reseed = patch.reseed; m.swaps = {}; }
  if (patch.swap) m.swaps = { ...(m.swaps || {}), [patch.swap.slot]: { foodId: patch.swap.foodId, grams: patch.swap.grams } };
  d[mealIdx] = m;
  state.overrides[day] = d;
  // Keep only the recent past and the future.
  const cutoff = addDays(today(), -14);
  for (const k of Object.keys(state.overrides)) if (k < cutoff) delete state.overrides[k];
  await db.kv.set('overrides', state.overrides);
  emit();
}

export async function toggleEaten(day, mealIdx) {
  const log = state.logs[day] || { eaten: [] };
  const set = new Set(log.eaten);
  if (set.has(mealIdx)) set.delete(mealIdx); else set.add(mealIdx);
  state.logs[day] = { eaten: [...set].sort((a, b) => a - b) };
  const cutoff = addDays(today(), -60);
  for (const k of Object.keys(state.logs)) if (k < cutoff) delete state.logs[k];
  await db.kv.set('logs', state.logs);
  emit();
}

export async function startNextPeriod(period) {
  const t = today();
  const cur = currentMetrics();
  state.periods = state.periods.map((p) => (p.status === 'active' ? { ...p, status: 'done', closedAt: t, endWeight: cur.weight, endBf: cur.bf } : p));
  const id = (state.periods[state.periods.length - 1]?.id || 0) + 1;
  state.periods.push({ id, ...period, startDate: t, endDate: addDays(t, period.weeks * 7), startWeight: cur.weight, startBf: cur.bf, status: 'active' });
  await db.kv.set('periods', state.periods);
  emit();
}

export async function saveShoppingChecks(key, ids) {
  state.shopping = { ...state.shopping, [key]: ids };
  // Keep the last few weeks only.
  const keys = Object.keys(state.shopping).map(Number).sort((a, b) => b - a);
  for (const k of keys.slice(4)) delete state.shopping[k];
  await db.kv.set('shopping', state.shopping);
}

export async function excludeFood(foodId) {
  const excluded = new Set(state.profile.prefs.excluded || []);
  excluded.add(foodId);
  await updateProfile({ prefs: { excluded: [...excluded] } });
}

export async function saveChat(messages) {
  state.chat = messages.slice(-60);
  await db.kv.set('chat', state.chat);
}

export async function getPhoto(id) {
  return db.get('photos', id);
}

export async function wipe() {
  await db.deleteEverything();
  try { localStorage.clear(); } catch { /* storage may be unavailable */ }
}
