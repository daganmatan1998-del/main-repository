// Runs supabase/setup.sql — the real file — on an in-process Postgres (PGlite)
// with Supabase's roles, auth.uid() and default grants stubbed in, and checks
// what each kind of user is allowed to do: the row-level security, the
// column grants, and the challenge functions.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const SETUP = readFileSync(new URL('../../supabase/setup.sql', import.meta.url), 'utf8');
const PRELUDE = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
  create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
  alter table storage.objects enable row level security;
  grant usage on schema public, auth, storage to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`;

let db;
const U = {};
const ids = ['ann', 'bob', 'cat', 'dan'];

before(async () => {
  db = new PGlite();
  await db.exec(PRELUDE);
  await db.exec(SETUP);
  for (const n of ids) {
    const r = await db.query('insert into auth.users (email) values ($1) returning id', [`${n}@x.test`]);
    U[n] = r.rows[0].id;
  }
});

// Runs fn as a signed-in user (the role and uid PostgREST would set).
async function as(name, fn) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [U[name]]);
  await db.exec('set role authenticated');
  try { return await fn(); } finally { await db.exec('reset role'); }
}
const q = (sql, params) => db.query(sql, params).then((r) => r.rows);
const fails = (promise, code) => assert.rejects(promise, (e) => (code ? e.code === code || String(e.message).includes(code) : true));
const sudo = async (sql, params) => { await db.exec('reset role'); return db.query(sql, params); };

test('setup.sql can be run again without errors', async () => {
  await db.exec(SETUP);
});

test('profiles: own row only, name and handle writable, score never', async () => {
  await as('ann', () => q("insert into public.nutri_profiles (user_id, username, display_name) values ($1, 'ann_a', 'Ann')", [U.ann]));
  await as('bob', () => q("insert into public.nutri_profiles (user_id, username, display_name) values ($1, 'bob_b', 'Bob')", [U.bob]));
  await as('cat', () => q("insert into public.nutri_profiles (user_id, username, display_name) values ($1, 'cat_c', 'Cat')", [U.cat]));
  await as('dan', () => q("insert into public.nutri_profiles (user_id, username, display_name) values ($1, 'dan_d', 'Dan')", [U.dan]));
  // everybody can read everybody's public profile
  assert.equal((await as('ann', () => q('select username from public.nutri_profiles order by username'))).length, 4);
  // not someone else's row, not a score, not a bad handle, not a duplicate
  await fails(as('ann', () => q("insert into public.nutri_profiles (user_id, username) values ($1, 'ann_two')", [U.bob])));
  await fails(as('ann', () => q("update public.nutri_profiles set wins = 99 where user_id = $1", [U.ann])), '42501');
  await fails(as('ann', () => q("insert into public.nutri_profiles (user_id, username, wins) values (gen_random_uuid(), 'zzz_z', 5)")), '42501');
  await fails(as('ann', () => q("update public.nutri_profiles set username = 'Bad Name' where user_id = $1", [U.ann])));
  await fails(as('ann', () => q("update public.nutri_profiles set username = 'bob_b' where user_id = $1", [U.ann])), '23505');
  assert.equal((await as('ann', () => q("update public.nutri_profiles set username = 'bob_b' where user_id = $1 returning 1", [U.bob]))).length, 0, "someone else's row is invisible to an update");
  // The title (level) is the person's own to report, within 0-20, and only on their own row.
  assert.equal((await as('ann', () => q('update public.nutri_profiles set level = 3 where user_id = $1 returning level', [U.ann])))[0].level, 3);
  await fails(as('ann', () => q('update public.nutri_profiles set level = 99 where user_id = $1', [U.ann])), '23514');
  await fails(as('ann', () => q('update public.nutri_profiles set level = -1 where user_id = $1', [U.ann])), '23514');
  assert.equal((await as('ann', () => q('update public.nutri_profiles set level = 5 where user_id = $1 returning 1', [U.bob]))).length, 0);
  assert.equal((await as('bob', () => q('select level from public.nutri_profiles where user_id = $1', [U.ann])))[0].level, 3, 'everyone can read it');
  await as('ann', () => q('update public.nutri_profiles set level = 0 where user_id = $1', [U.ann]));
  // renaming yourself works (this is what the app does: PATCH)
  assert.equal((await as('ann', () => q("update public.nutri_profiles set username = 'ann_x', display_name = 'Ann K' where user_id = $1 returning username", [U.ann])))[0].username, 'ann_x');
  // …and an upsert would have been refused: it rewrites user_id too
  await fails(as('ann', () => q("insert into public.nutri_profiles (user_id, username, display_name) values ($1, 'ann_y', 'A') on conflict (user_id) do update set user_id = excluded.user_id, username = excluded.username, display_name = excluded.display_name", [U.ann])), '42501');
  assert.equal((await q('select count(*)::int as n from public.nutri_profiles'))[0].n, 4);
});

test('friend requests: sender asks, recipient answers, both can delete', async () => {
  await as('ann', () => q('insert into public.nutri_friend_requests (from_user, to_user) values ($1, $2)', [U.ann, U.bob]));
  await fails(as('ann', () => q('insert into public.nutri_friend_requests (from_user, to_user) values ($1, $2)', [U.bob, U.cat])), '42501');
  await fails(as('ann', () => q('insert into public.nutri_friend_requests (from_user, to_user) values ($1, $2)', [U.ann, U.bob])), '23505');
  await fails(as('ann', () => q('insert into public.nutri_friend_requests (from_user, to_user) values ($1, $1)', [U.ann])));
  await fails(as('ann', () => q("insert into public.nutri_friend_requests (from_user, to_user, status) values ($1, $2, 'accepted')", [U.ann, U.cat])), '42501');
  assert.equal((await as('cat', () => q('select 1 from public.nutri_friend_requests'))).length, 0, 'an outsider sees nothing');
  assert.equal((await as('ann', () => q("update public.nutri_friend_requests set status = 'accepted' where from_user = $1 returning 1", [U.ann]))).length, 0, 'the sender cannot accept their own request');
  assert.equal((await as('bob', () => q("update public.nutri_friend_requests set status = 'accepted', updated_at = now() where to_user = $1 returning status", [U.bob])))[0].status, 'accepted');
  await fails(as('bob', () => q("update public.nutri_friend_requests set from_user = $1 where to_user = $2", [U.cat, U.bob])), '42501');
  // ann–bob are friends; make ann–cat and bob–dan friends for the challenge tests
  await sudo("insert into public.nutri_friend_requests (from_user, to_user, status) values ($1, $2, 'accepted'), ($3, $4, 'accepted')", [U.ann, U.cat, U.bob, U.dan]);
});

const call = (name, sql, params) => as(name, () => q(sql, params));
const ymd = (offset) => q("select (current_date + $1::int)::text as d", [offset]).then((r) => r[0].d);

async function newChallenge(from, to, days = 5, max = 2) {
  const [{ create_challenge: id }] = await call(from, 'select public.create_challenge($1, $2, $3)', [U[to], days, max]);
  return id;
}
async function activate(id, who) {
  await call(who, 'select public.respond_challenge($1, true, current_date)', [id]);
}
// Moves a running challenge back in time so its days are closed, and writes the
// days both players reported.
async function replay(id, { start, rows }) {
  await sudo('update public.nutri_challenges set start_date = current_date + $2::int, end_date = current_date + $2::int + days - 1 where id = $1', [id, start]);
  for (const [user, off, planned, logged] of rows) {
    await sudo('insert into public.nutri_challenge_days (challenge_id, user_id, day, planned, logged) values ($1, $2, current_date + $3::int, $4, $5)', [id, U[user], off, planned, logged]);
  }
}
const status = (id) => q('select status, loser, result from public.nutri_challenges where id = $1', [id]).then((r) => r[0]);
const score = async (n) => (await q('select wins, losses from public.nutri_profiles where user_id = $1', [U[n]]))[0];

test('challenges: only friends, valid rules, one at a time, nothing written directly', async () => {
  await fails(call('ann', 'select public.create_challenge($1, 7, 3)', [U.dan]), '42501'); // not friends
  await fails(call('ann', 'select public.create_challenge($1, 2, 3)', [U.bob]), '22023'); // too short
  await fails(call('ann', 'select public.create_challenge($1, 7, 31)', [U.bob]), '22023');
  await fails(call('ann', 'select public.create_challenge($1, 7, 3)', [U.ann]), '22023');
  const id = await newChallenge('ann', 'bob', 7, 3);
  await fails(call('bob', 'select public.create_challenge($1, 7, 3)', [U.ann]), '23505'); // already one between them
  assert.equal((await status(id)).status, 'pending');
  await fails(as('ann', () => q("insert into public.nutri_challenges (creator, opponent, days, max_misses) values ($1, $2, 7, 3)", [U.ann, U.cat])), '42501');
  await fails(as('ann', () => q("update public.nutri_challenges set status = 'finished' where id = $1", [id])), '42501');
  await fails(as('ann', () => q("delete from public.nutri_challenges where id = $1", [id])), '42501');
  assert.equal((await as('cat', () => q('select 1 from public.nutri_challenges'))).length, 0, 'an outsider sees nothing');
  // answering: only the one asked; the creator can only take it back
  await fails(call('ann', 'select public.respond_challenge($1, true, current_date)', [id]), '42501');
  await fails(call('cat', 'select public.respond_challenge($1, true, current_date)', [id]), '42501');
  await fails(call('bob', 'select public.cancel_challenge($1)', [id]), '42501');
  await call('ann', 'select public.cancel_challenge($1)', [id]);
  assert.equal((await status(id)).status, 'cancelled');
  await fails(call('bob', 'select public.respond_challenge($1, true, current_date)', [id]), '42501');
  // declined
  const id2 = await newChallenge('ann', 'bob');
  assert.equal((await call('bob', 'select public.respond_challenge($1, false, current_date) as s', [id2]))[0].s, 'declined');
});

test('challenges: accepting starts it tomorrow for the chosen number of days; the clock cannot be wound far', async () => {
  const id = await newChallenge('ann', 'bob', 5, 2);
  await fails(call('bob', 'select public.respond_challenge($1, true, current_date + 5)', [id]), '22007');
  assert.equal((await call('bob', 'select public.respond_challenge($1, true, current_date) as s', [id]))[0].s, 'active');
  const c = (await q('select start_date::text as s, end_date::text as e from public.nutri_challenges where id = $1', [id]))[0];
  assert.equal(c.s, await ymd(1));
  assert.equal(c.e, await ymd(5));
  await call('ann', 'select public.forfeit_challenge($1)', [id]);
});

test('challenges: whoever goes over the allowed misses first loses at once, and the scores follow', async () => {
  const before = { ann: await score('ann'), bob: await score('bob') };
  const id = await newChallenge('ann', 'bob', 6, 2);
  await activate(id, 'bob');
  // days -3..-1: ann missed 1 + 0 + 0, bob 2 + 1 + 0 = 3 > 2
  await replay(id, { start: -3, rows: [['ann', -3, 4, 3], ['ann', -2, 4, 4], ['ann', -1, 4, 4], ['bob', -3, 4, 2], ['bob', -2, 4, 3], ['bob', -1, 4, 4]] });
  assert.equal((await call('ann', 'select public.evaluate_challenge($1, current_date) as s', [id]))[0].s, 'finished');
  const r = await status(id);
  assert.deepEqual([r.status, r.loser, r.result], ['finished', U.bob, 'loss']);
  assert.equal((await score('bob')).losses, before.bob.losses + 1);
  assert.equal((await score('ann')).wins, before.ann.wins + 1);
  // evaluating again changes nothing
  await call('bob', 'select public.evaluate_challenge($1, current_date)', [id]);
  assert.equal((await score('bob')).losses, before.bob.losses + 1);
});

test('challenges: at the end of the period the one who missed more loses; equal is a draw', async () => {
  const id = await newChallenge('ann', 'cat', 3, 5);
  await activate(id, 'cat');
  await replay(id, { start: -4, rows: [['ann', -4, 4, 4], ['ann', -3, 4, 3], ['ann', -2, 4, 4], ['cat', -4, 4, 4], ['cat', -3, 4, 4], ['cat', -2, 4, 4]] });
  // period (-4..-2) is over, nobody went over 5; ann missed 1, cat 0
  await call('cat', 'select public.evaluate_challenge($1, current_date)', [id]);
  const r = await status(id);
  assert.deepEqual([r.status, r.loser], ['finished', U.ann]);
  const before = { cat: await score('cat'), ann: await score('ann') };
  const draw = await newChallenge('cat', 'ann', 3, 5);
  await activate(draw, 'ann');
  await replay(draw, { start: -4, rows: [['ann', -4, 4, 3], ['ann', -3, 4, 4], ['ann', -2, 4, 4], ['cat', -4, 4, 4], ['cat', -3, 4, 4], ['cat', -2, 4, 3]] });
  await call('ann', 'select public.evaluate_challenge($1, current_date)', [draw]);
  const d = await status(draw);
  assert.deepEqual([d.status, d.loser, d.result], ['finished', null, 'draw']);
  assert.deepEqual([await score('cat'), await score('ann')], [before.cat, before.ann], 'a draw changes no score');
});

test('challenges: a day nobody reported counts as missed — stopping loses', async () => {
  const id = await newChallenge('bob', 'dan', 4, 3);
  await activate(id, 'dan');
  // bob reports every closed day in full; dan reports nothing → 3 missed meals a day (the fallback) × 2 closed days
  await replay(id, { start: -3, rows: [['bob', -3, 4, 4], ['bob', -2, 4, 4]] });
  await call('bob', 'select public.evaluate_challenge($1, current_date)', [id]);
  const r = await status(id);
  assert.deepEqual([r.status, r.loser], ['finished', U.dan]);
});

test('challenges: reporting a day — only your own challenge, only today and yesterday, never more than planned', async () => {
  const id = await newChallenge('ann', 'bob', 5, 30);
  await activate(id, 'bob');
  await sudo('update public.nutri_challenges set start_date = current_date - 3, end_date = current_date + 1 where id = $1', [id]);
  await fails(call('cat', 'select public.report_challenge_day($1, current_date, 4, 4, current_date)', [id]), '42501');
  await call('ann', 'select public.report_challenge_day($1, current_date, 4, 6, current_date)', [id]);
  assert.deepEqual((await q('select planned, logged from public.nutri_challenge_days where challenge_id = $1 and user_id = $2 and day = current_date', [id, U.ann]))[0], { planned: 4, logged: 4 }, 'logged is capped by planned');
  await call('ann', 'select public.report_challenge_day($1, current_date, 4, 2, current_date)', [id]);
  assert.equal((await q('select logged from public.nutri_challenge_days where challenge_id = $1 and user_id = $2 and day = current_date', [id, U.ann]))[0].logged, 2, 'today can still change');
  await call('ann', 'select public.report_challenge_day($1, current_date - 2, 4, 4, current_date)', [id]);
  assert.equal((await q('select 1 from public.nutri_challenge_days where challenge_id = $1 and day = current_date - 2', [id])).length, 0, 'two days back is closed');
  await call('ann', 'select public.report_challenge_day($1, current_date + 1, 4, 4, current_date)', [id]);
  assert.equal((await q('select 1 from public.nutri_challenge_days where challenge_id = $1 and day = current_date + 1', [id])).length, 0, 'the future is not reported');
  await fails(call('ann', 'select public.report_challenge_day($1, current_date, 2, 2, current_date)', [id]), '23514'); // planned must be 3–6
  await fails(as('ann', () => q('insert into public.nutri_challenge_days (challenge_id, user_id, day, planned, logged) values ($1, $2, current_date, 4, 4)', [id, U.ann])), '42501');
  // both players see both players' days
  await call('ann', 'select public.report_challenge_day($1, current_date, 4, 4, current_date)', [id]);
  await call('bob', 'select public.report_challenge_day($1, current_date, 4, 3, current_date)', [id]);
  assert.equal((await as('bob', () => q('select user_id from public.nutri_challenge_days where challenge_id = $1', [id]))).length, 2);
  await call('bob', 'select public.forfeit_challenge($1)', [id]);
  const r = await status(id);
  assert.deepEqual([r.status, r.loser], ['finished', U.bob]);
  await fails(call('bob', 'select public.forfeit_challenge($1)', [id]), '42501');
});

test('deleting an account removes its profile, requests and challenges', async () => {
  await sudo('delete from auth.users where id = $1', [U.dan]);
  assert.equal((await q('select 1 from public.nutri_profiles where user_id = $1', [U.dan])).length, 0);
  assert.equal((await q('select 1 from public.nutri_challenges where $1 in (creator, opponent)', [U.dan])).length, 0);
});
