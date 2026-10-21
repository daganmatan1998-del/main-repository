// Challenges between two friends: a period, and a number of misses allowed. A
// "miss" is a planned meal that was not marked as eaten before its day ended.
// Whoever goes over the allowed misses first loses at once; if nobody does,
// whoever missed more when the period ends loses (equal = a draw). Profiles keep
// the wins and losses. The rules live in supabase/setup.sql (the server decides);
// what is here fetches, shows and — in `misses` — mirrors the same counting so
// the scoreboard can be drawn without another request.
//
// Pure except `net`, the transport (cloud.rest in the app), so the tests can
// drive it with a fake.

import * as cloud from './cloud.js';
import { addDays, daysBetween, dayKey } from './util.js';

let net = (...a) => cloud.rest(...a);
export const setTransport = (fn) => { net = fn; };
let me = () => cloud.userId();
export const setMe = (fn) => { me = fn; };

export const PRESET_DAYS = [7, 14, 30];
export const MIN_DAYS = 3;
export const MAX_DAYS = 30;
export const MAX_MISSES = 30;
export const MAX_OPEN = 5;
export const DEFAULTS = { days: 7, maxMisses: 3 };
const RECENT_FINISHED = 10;

// An Error whose code says what to tell the person.
export function fail(r) {
  const text = r && r.data && (r.data.message || r.data.hint || '');
  const known = ['not_friends', 'no_profile', 'already_challenged', 'too_many', 'bad_rules', 'bad_date', 'not_allowed'].find((k) => String(text).includes(k));
  const missing = r && (r.status === 404 || (r.data && ['PGRST202', 'PGRST205', '42P01', '42883'].includes(r.data.code)));
  const code = known || (missing ? 'not_set_up' : 'unavailable');
  const e = new Error(code);
  e.code = code;
  e.status = r && r.status;
  if (typeof console !== 'undefined') console.warn('challenge request failed', r && r.status, r && r.data && (r.data.code || r.data.message));
  return e;
}

// ---- counting (the same as nutri_misses in setup.sql) ----

// rows: the days one player reported ({ day, planned, logged }). From `from` to
// `to` (inclusive): planned minus logged on a reported day, and a whole day —
// their usual number of meals, at least 3 — for a day nobody reported.
export function misses(rows, from, to) {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const fallback = rows.length ? Math.max(...rows.map((r) => r.planned)) : 3;
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const r = byDay.get(d);
    n += r ? Math.max(r.planned - r.logged, 0) : fallback;
  }
  return n;
}

// Everything a screen needs about one challenge, for the person `meId`, on
// day `todayKey`: who is who, the days so far, the misses, and what is next.
export function view(c, dayRows, meId, todayKey) {
  const mine = c.creator === meId;
  const myId = meId;
  const otherId = mine ? c.opponent : c.creator;
  const rowsOf = (uid) => dayRows.filter((r) => r.user_id === uid).map((r) => ({ day: r.day, planned: r.planned, logged: r.logged }));
  const my = rowsOf(myId);
  const their = rowsOf(otherId);
  const out = {
    id: c.id, status: c.status, days: c.days, maxMisses: c.max_misses, iAmCreator: mine, otherId,
    start: c.start_date, end: c.end_date, result: c.result, loser: c.loser, finishedAt: c.finished_at,
    iLost: c.result === 'loss' && c.loser === myId, iWon: c.result === 'loss' && c.loser !== myId, draw: c.result === 'draw',
    mine: { missed: 0 }, theirs: { missed: 0 }, perDay: [], dayNumber: 0, started: false, startsInDays: 0, daysLeft: 0,
  };
  if (c.status !== 'active' && c.status !== 'finished') return out;
  out.started = todayKey >= c.start_date;
  out.startsInDays = Math.max(0, daysBetween(todayKey, c.start_date));
  // A finished challenge is looked at as of the day it was settled (days after that were never played).
  // A day counts once the day after it has begun (the server's rule, see nutri_evaluate).
  const ref = c.status === 'finished' ? (c.final_day || (c.finished_at ? dayKey(new Date(c.finished_at)) : todayKey)) : todayKey;
  const closedEnd = [c.end_date, addDays(ref, -2)].sort()[0];
  out.mine.missed = misses(my, c.start_date, closedEnd);
  out.theirs.missed = misses(their, c.start_date, closedEnd);
  out.dayNumber = out.started ? Math.min(c.days, daysBetween(c.start_date, todayKey) + 1) : 0;
  out.daysLeft = Math.max(0, daysBetween(todayKey, c.end_date) + (todayKey <= c.end_date ? 1 : 0));
  const mine1 = new Map(my.map((r) => [r.day, r]));
  const theirs1 = new Map(their.map((r) => [r.day, r]));
  const last = [c.end_date, ref].sort()[0];
  for (let d = c.start_date; d <= last; d = addDays(d, 1)) {
    const closed = d <= closedEnd;
    out.perDay.push({ day: d, closed, today: d === todayKey, mine: mine1.get(d) || null, theirs: theirs1.get(d) || null });
  }
  return out;
}

// ---- fetching ----
const FIELDS = 'id,creator,opponent,status,days,max_misses,start_date,end_date,loser,result,created_at,updated_at,finished_at,final_day';

// [{ ...view, other: profile }] newest first.
export async function list(todayKey, profilesByIds) {
  const meId = me();
  const r = await net(`nutri_challenges?select=${FIELDS}&or=(creator.eq.${meId},opponent.eq.${meId})&order=created_at.desc&limit=50`);
  if (!r.ok) throw fail(r);
  const rows = r.data;
  if (!rows.length) return [];
  // The days of the running challenges and of the latest finished ones (at most 60 rows each,
  // so two requests stay under the server's row limit); older finished ones show only their result.
  const running = rows.filter((c) => c.status === 'active').slice(0, MAX_OPEN).map((c) => c.id);
  const recent = rows.filter((c) => c.status === 'finished').slice(0, RECENT_FINISHED).map((c) => c.id);
  const withDays = new Set([...running, ...recent]);
  let dayRows = [];
  for (const ids of [running, recent]) {
    if (!ids.length) continue;
    const d = await net(`nutri_challenge_days?select=challenge_id,user_id,day,planned,logged&challenge_id=in.(${ids.join(',')})&order=day.asc&limit=1000`);
    if (!d.ok) throw fail(d);
    dayRows = dayRows.concat(d.data);
  }
  const others = [...new Set(rows.map((c) => (c.creator === meId ? c.opponent : c.creator)))];
  const people = await profilesByIds(others);
  return rows.map((c) => ({ ...view(c, dayRows.filter((x) => x.challenge_id === c.id), meId, todayKey), noDays: (c.status === 'active' || c.status === 'finished') && !withDays.has(c.id), createdAt: c.created_at, updatedAt: c.updated_at, other: people[c.creator === meId ? c.opponent : c.creator] || null }));
}

// ---- actions (each is a function in setup.sql; the server checks who is asking) ----
async function rpc(name, args) {
  const r = await net(`rpc/${name}`, { method: 'POST', body: args });
  if (!r.ok) throw fail(r);
  return r.data;
}
export const create = (opponentId, days, maxMisses) => rpc('create_challenge', { p_opponent: opponentId, p_days: days, p_max_misses: maxMisses });
export const respond = (id, accept, todayKey) => rpc('respond_challenge', { p_id: id, p_accept: !!accept, p_today: todayKey });
export const cancel = (id) => rpc('cancel_challenge', { p_id: id });
export const forfeit = (id) => rpc('forfeit_challenge', { p_id: id });
export const report = (id, day, planned, logged, todayKey) => rpc('report_challenge_day', { p_id: id, p_day: day, p_planned: planned, p_logged: logged, p_today: todayKey });
export const evaluate = (id, todayKey) => rpc('evaluate_challenge', { p_id: id, p_today: todayKey });

// The days of an active challenge this phone should report now: today and
// yesterday inside the period, where what it counts differs from what the
// server already has. count(day) -> { planned, logged }.
export function dueReports(v, todayKey, count) {
  if (v.status !== 'active' || !v.start) return [];
  const out = [];
  for (const d of [addDays(todayKey, -1), todayKey]) {
    if (d < v.start || d > v.end) continue;
    const c = count(d);
    if (!c || c.planned < 3) continue;
    const known = (v.perDay.find((p) => p.day === d) || {}).mine;
    if (known && known.planned === c.planned && known.logged === Math.min(c.logged, c.planned)) continue;
    out.push({ day: d, planned: Math.min(6, c.planned), logged: Math.min(c.logged, c.planned) });
  }
  return out;
}

// Whether a period that has ended still needs the server to settle it.
export const needsSettling = (v, todayKey) => v.status === 'active' && v.end && todayKey > addDays(v.end, 1);

export const openCount = (list) => list.filter((c) => c.status === 'pending' || c.status === 'active').length;
export const invitations = (list) => list.filter((c) => c.status === 'pending' && !c.iAmCreator);
export const sentInvitations = (list) => list.filter((c) => c.status === 'pending' && c.iAmCreator);
export const running = (list) => list.filter((c) => c.status === 'active');
export const withFriend = (list, userId) => list.find((c) => (c.status === 'pending' || c.status === 'active') && c.otherId === userId) || null;

// What the record looks like for a list: wins, losses, draws.
export function record(list) {
  const done = list.filter((c) => c.status === 'finished');
  return { wins: done.filter((c) => c.iWon).length, losses: done.filter((c) => c.iLost).length, draws: done.filter((c) => c.draw).length };
}
