import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ch from '../../www/js/challenges.js';

const ME = 'u-me';
const BOB = 'u-bob';
const row = (user, day, planned, logged) => ({ challenge_id: 'c1', user_id: user, day, planned, logged });
const base = { id: 'c1', creator: ME, opponent: BOB, status: 'active', days: 5, max_misses: 3, start_date: '2026-10-10', end_date: '2026-10-14', loser: null, result: null, finished_at: null };

test('misses: planned minus logged, and a whole day for a day nobody reported', () => {
  const rows = [{ day: '2026-10-10', planned: 4, logged: 3 }, { day: '2026-10-11', planned: 4, logged: 4 }];
  assert.equal(ch.misses(rows, '2026-10-10', '2026-10-11'), 1);
  assert.equal(ch.misses(rows, '2026-10-10', '2026-10-13'), 1 + 4 + 4, 'two unreported days count as the usual 4 meals each');
  assert.equal(ch.misses([], '2026-10-10', '2026-10-11'), 6, 'no report at all: 3 a day');
  assert.equal(ch.misses(rows, '2026-10-12', '2026-10-11'), 0, 'an empty range');
  assert.equal(ch.misses([{ day: '2026-10-10', planned: 4, logged: 6 }], '2026-10-10', '2026-10-10'), 0, 'never negative');
});

test('view: the day number, the misses of both, and the days so far', () => {
  const days = [row(ME, '2026-10-10', 4, 3), row(ME, '2026-10-11', 4, 4), row(BOB, '2026-10-10', 4, 4), row(BOB, '2026-10-11', 4, 1), row(ME, '2026-10-12', 4, 2)];
  const v = ch.view(base, days, ME, '2026-10-12');
  assert.equal(v.dayNumber, 3);
  assert.equal(v.daysLeft, 3);
  assert.equal(v.mine.missed, 1, "today's and yesterday's days are not counted yet (the other player can still report them)");
  assert.equal(v.theirs.missed, 0);
  assert.deepEqual(v.perDay.map((d) => [d.day, d.closed, d.today]), [['2026-10-10', true, false], ['2026-10-11', false, false], ['2026-10-12', false, true]]);
  assert.equal(v.iAmCreator, true);
  const next = ch.view(base, days, ME, '2026-10-13');
  assert.equal(next.theirs.missed, 3, 'a day counts once the day after it has begun');
  const asBob = ch.view(base, days, BOB, '2026-10-13');
  assert.equal(asBob.mine.missed, 3);
  assert.equal(asBob.theirs.missed, 1);
  assert.equal(asBob.otherId, ME);
});

test('view: before it starts, after it ends, and once decided', () => {
  const before = ch.view(base, [], ME, '2026-10-09');
  assert.deepEqual([before.started, before.startsInDays, before.dayNumber, before.perDay.length], [false, 1, 0, 0]);
  const over = ch.view(base, [], ME, '2026-10-20');
  assert.equal(over.dayNumber, 5);
  assert.equal(over.daysLeft, 0);
  const done = ch.view({ ...base, status: 'finished', result: 'loss', loser: BOB, finished_at: '2026-10-13T20:00:00Z' }, [row(ME, '2026-10-10', 4, 4), row(BOB, '2026-10-10', 4, 0), row(BOB, '2026-10-11', 4, 0)], ME, '2026-10-30');
  assert.deepEqual([done.iWon, done.iLost, done.draw], [true, false, false]);
  assert.equal(done.theirs.missed, 8, 'counted up to the day it was settled, not for days never played');
  assert.equal(done.perDay.length, 4);
  // settled at 01:30 Israel time (22:30 UTC the day before): the settling phone's own day decides, not the UTC date
  const late = ch.view({ ...base, status: 'finished', result: 'draw', start_date: '2026-10-14', end_date: '2026-10-14', final_day: '2026-10-16', finished_at: '2026-10-15T22:30:00Z' }, [row(ME, '2026-10-14', 4, 2), row(BOB, '2026-10-14', 4, 2)], ME, '2026-10-30');
  assert.equal(late.mine.missed + late.theirs.missed, 4, 'the last day of the period is counted');
  const noFinal = ch.view({ ...base, status: 'finished', result: 'draw', start_date: '2026-10-14', end_date: '2026-10-14', finished_at: '2026-10-16T12:00:00Z' }, [row(ME, '2026-10-14', 4, 2), row(BOB, '2026-10-14', 4, 2)], ME, '2026-10-30');
  assert.equal(noFinal.mine.missed, late.mine.missed, 'without final_day, the local day of the timestamp gives the same answer');
  const draw = ch.view({ ...base, status: 'finished', result: 'draw', finished_at: '2026-10-15T01:00:00Z' }, [], ME, '2026-10-30');
  assert.equal(draw.draw, true);
  assert.equal(ch.view({ ...base, status: 'pending', start_date: null, end_date: null }, [], ME, '2026-10-09').perDay.length, 0);
});

test('dueReports: today and yesterday inside the period, only where the server differs', () => {
  const v = ch.view(base, [row(ME, '2026-10-11', 4, 4)], ME, '2026-10-12');
  const count = (d) => ({ '2026-10-11': { planned: 4, logged: 4 }, '2026-10-12': { planned: 4, logged: 2 } }[d]);
  assert.deepEqual(ch.dueReports(v, '2026-10-12', count), [{ day: '2026-10-12', planned: 4, logged: 2 }], 'yesterday already matches');
  assert.deepEqual(ch.dueReports(v, '2026-10-12', () => null), []);
  assert.deepEqual(ch.dueReports(v, '2026-10-12', () => ({ planned: 2, logged: 2 })), [], 'fewer than 3 planned meals is not reported');
  const first = ch.view(base, [], ME, '2026-10-10');
  assert.deepEqual(ch.dueReports(first, '2026-10-10', () => ({ planned: 4, logged: 9 })).map((d) => [d.day, d.logged]), [['2026-10-10', 4]], 'the day before the start is outside; logged never above planned');
  assert.deepEqual(ch.dueReports({ ...v, status: 'finished' }, '2026-10-12', count), []);
  assert.equal(ch.needsSettling(ch.view(base, [], ME, '2026-10-15'), '2026-10-15'), false, 'one day of grace after the period ends');
  assert.equal(ch.needsSettling(ch.view(base, [], ME, '2026-10-16'), '2026-10-16'), true);
});

test('settling, lists and the record', () => {
  const v = ch.view(base, [], ME, '2026-10-20');
  assert.equal(ch.needsSettling(v, '2026-10-20'), true);
  assert.equal(ch.needsSettling(v, '2026-10-14'), false);
  const list = [
    { ...ch.view({ ...base, id: 'a', status: 'pending', creator: BOB, opponent: ME, start_date: null, end_date: null }, [], ME, '2026-10-12'), other: {} },
    { ...ch.view({ ...base, id: 'b', status: 'pending', start_date: null, end_date: null }, [], ME, '2026-10-12') },
    ch.view({ ...base, id: 'c' }, [], ME, '2026-10-12'),
    ch.view({ ...base, id: 'd', status: 'finished', result: 'loss', loser: BOB, finished_at: '2026-10-14T00:00:00Z' }, [], ME, '2026-10-30'),
    ch.view({ ...base, id: 'e', status: 'finished', result: 'loss', loser: ME, finished_at: '2026-10-14T00:00:00Z' }, [], ME, '2026-10-30'),
    ch.view({ ...base, id: 'f', status: 'finished', result: 'draw', finished_at: '2026-10-14T00:00:00Z' }, [], ME, '2026-10-30'),
  ];
  assert.deepEqual(ch.invitations(list).map((c) => c.id), ['a']);
  assert.deepEqual(ch.sentInvitations(list).map((c) => c.id), ['b']);
  assert.deepEqual(ch.running(list).map((c) => c.id), ['c']);
  assert.equal(ch.openCount(list), 3);
  assert.deepEqual(ch.record(list), { wins: 1, losses: 1, draws: 1 });
  assert.equal(ch.withFriend(list, BOB).id, 'a');
  assert.equal(ch.withFriend(list, 'nobody'), null);
});

test('the actions call the server functions and turn failures into codes', async () => {
  ch.setMe(() => ME);
  const calls = [];
  ch.setTransport(async (path, opts) => { calls.push([path, opts && opts.body]); return { ok: true, status: 200, data: 'x' }; });
  await ch.create(BOB, 7, 3);
  await ch.respond('c1', true, '2026-10-12');
  await ch.report('c1', '2026-10-12', 4, 3, '2026-10-12');
  assert.deepEqual(calls[0], ['rpc/create_challenge', { p_opponent: BOB, p_days: 7, p_max_misses: 3 }]);
  assert.deepEqual(calls[1], ['rpc/respond_challenge', { p_id: 'c1', p_accept: true, p_today: '2026-10-12' }]);
  assert.deepEqual(calls[2], ['rpc/report_challenge_day', { p_id: 'c1', p_day: '2026-10-12', p_planned: 4, p_logged: 3, p_today: '2026-10-12' }]);
  const err = (status, data) => async () => ({ ok: false, status, data });
  for (const [status, data, code] of [[403, { code: '42501', message: 'not_friends' }, 'not_friends'], [409, { code: '23505', message: 'already_challenged' }, 'already_challenged'], [404, { code: 'PGRST202' }, 'not_set_up'], [500, {}, 'unavailable'], [400, { message: 'too_many' }, 'too_many']]) {
    ch.setTransport(err(status, data));
    await assert.rejects(() => ch.create(BOB, 7, 3), (e) => e.code === code, code);
  }
});

test('list joins the challenges, the days and the other players', async () => {
  ch.setMe(() => ME);
  const challenges = [{ ...base }, { ...base, id: 'c2', creator: 'u-cat', opponent: ME, status: 'pending', start_date: null, end_date: null }];
  ch.setTransport(async (path) => {
    if (path.startsWith('nutri_challenges?')) return { ok: true, status: 200, data: challenges };
    if (path.startsWith('nutri_challenge_days?')) { assert.match(path, /challenge_id=in\.\(c1\)/, 'only running or finished ones have days'); return { ok: true, status: 200, data: [row(ME, '2026-10-10', 4, 4)] }; }
    throw new Error(path);
  });
  const people = { [BOB]: { user_id: BOB, username: 'bob' }, 'u-cat': { user_id: 'u-cat', username: 'cat' } };
  const list = await ch.list('2026-10-13', async (ids) => Object.fromEntries(ids.map((i) => [i, people[i]])));
  assert.deepEqual(list.map((c) => [c.id, c.other.username, c.status]), [['c1', 'bob', 'active'], ['c2', 'cat', 'pending']]);
  assert.equal(list[0].mine.missed, 4, 'I reported day 1 in full, and nothing for day 2: my usual 4 meals');
  assert.equal(list[0].theirs.missed, 6, 'Bob reported nothing for the two days: the usual 3 meals each');
  ch.setTransport(async () => ({ ok: true, status: 200, data: [] }));
  assert.deepEqual(await ch.list('2026-10-11', async () => ({})), []);
});

test('list: many finished challenges - the days of the latest ones are fetched, older ones only show the result', async () => {
  ch.setMe(() => ME);
  const fin = (i) => ({ ...base, id: `f${i}`, status: 'finished', result: 'draw', created_at: `2026-09-${String(30 - i).padStart(2, '0')}` });
  const challenges = [{ ...base, id: 'run' }, ...Array.from({ length: 14 }, (_, i) => fin(i))];
  const asked = [];
  ch.setTransport(async (path) => {
    if (path.startsWith('nutri_challenges?')) return { ok: true, status: 200, data: challenges };
    if (path.startsWith('nutri_challenge_days?')) { asked.push(path); return { ok: true, status: 200, data: [] }; }
    throw new Error(path);
  });
  const list = await ch.list('2026-10-12', async () => ({}));
  assert.equal(asked.length, 2, 'running and finished are separate requests, so neither passes the server row limit');
  assert.match(asked[0], /challenge_id=in\.\(run\)/);
  assert.equal((asked[1].match(/f\d+/g) || []).length, 10);
  assert.match(asked[1], /order=day\.asc/);
  assert.equal(list.filter((c) => c.noDays).length, 4);
  assert.equal(list.find((c) => c.id === 'run').noDays, false);
});
