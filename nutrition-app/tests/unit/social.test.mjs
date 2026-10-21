import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as social from '../../www/js/social.js';

const ME = 'u-me';
const people = {
  'u-bob': { user_id: 'u-bob', username: 'bob', display_name: 'Bob', wins: 3, losses: 1 },
  'u-carol': { user_id: 'u-carol', username: 'carol', display_name: 'Carol', wins: 0, losses: 0 },
  'u-dan': { user_id: 'u-dan', username: 'dan', display_name: 'Dan', wins: 0, losses: 2 },
  'u-eve': { user_id: 'u-eve', username: 'eve', display_name: 'Eve', wins: 1, losses: 0 },
};
social.setMe(() => ME);

test('usernames: lower case, no @, 3–20 of a–z 0–9 _', () => {
  assert.equal(social.normalizeUsername('  @Dana_K '), 'dana_k');
  assert.equal(social.normalizeUsername('Shadow Guy'), 'shadow_guy');
  assert.equal(social.normalizeUsername('shadow-guy'), 'shadow_guy');
  assert.equal(social.normalizeUsername('a.b  c'), 'a_b_c');
  for (const ok of ['abc', 'dana_k', 'a1_', 'x'.repeat(20)]) assert.ok(social.validUsername(ok), ok);
  for (const bad of ['ab', 'x'.repeat(21), 'da na', 'דנה', 'a-b', 'a.b', '', social.normalizeUsername('דנה')]) assert.ok(!social.validUsername(bad), bad);
});

test('the invite link and the WhatsApp message', () => {
  const link = social.linkFor('dana', 'https://nutri.example/app/');
  assert.equal(link, 'https://nutri.example/app/#/u/dana');
  const wa = social.whatsappUrl('Add me on Nutri:', link);
  assert.ok(wa.startsWith('https://wa.me/?text='));
  assert.equal(decodeURIComponent(wa.slice('https://wa.me/?text='.length)), 'Add me on Nutri:\nhttps://nutri.example/app/#/u/dana');
});

test('a profile hash gives the username, anything else gives null', () => {
  assert.equal(social.usernameFromHash('#/u/Dana_K'), 'dana_k');
  assert.equal(social.usernameFromHash('#/u/@dana'), 'dana');
  assert.equal(social.usernameFromHash('#/u/dana/'), 'dana');
  for (const bad of ['#/today', '#/u/', '#/u/a b', '#/u/' + 'x'.repeat(40), '', null]) assert.equal(social.usernameFromHash(bad), null, String(bad));
});

test('win rate: a share of finished challenges, null before any', () => {
  assert.equal(social.winRate(people['u-bob']), 75);
  assert.equal(social.winRate(people['u-carol']), null);
  assert.equal(social.winRate(people['u-dan']), 0);
  assert.equal(social.winRate({ wins: 1, losses: 2 }), 33);
});

const rows = [
  { id: 'r1', from_user: 'u-bob', to_user: ME, status: 'pending', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' },
  { id: 'r2', from_user: ME, to_user: 'u-carol', status: 'pending', created_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' },
  { id: 'r3', from_user: ME, to_user: 'u-dan', status: 'accepted', created_at: '2026-10-03T00:00:00Z', updated_at: '2026-10-04T00:00:00Z' },
  { id: 'r4', from_user: 'u-eve', to_user: ME, status: 'accepted', created_at: '2026-10-03T00:00:00Z', updated_at: '2026-10-05T00:00:00Z' },
  { id: 'r5', from_user: ME, to_user: 'u-frank', status: 'declined', created_at: '2026-10-03T00:00:00Z', updated_at: '2026-10-05T00:00:00Z' },
];
const net = (calls = []) => async (path, opts = {}) => {
  calls.push({ path, ...opts });
  if (path.startsWith('nutri_friend_requests?select')) return { ok: true, status: 200, data: rows };
  if (path.startsWith('nutri_profiles?select') && path.includes('user_id=in.(')) {
    const ids = path.match(/in\.\(([^)]*)\)/)[1].split(',');
    return { ok: true, status: 200, data: ids.map((i) => people[i]).filter(Boolean) };
  }
  return { ok: true, status: 201, data: null };
};

test('relations() sorts requests into incoming, sent and friends, and hides declined ones we sent', async () => {
  social.setTransport(net());
  const rel = await social.relations();
  assert.deepEqual(rel.incoming.map((e) => e.user.username), ['bob']);
  assert.deepEqual(rel.outgoing.map((e) => e.user.username), ['carol']);
  assert.deepEqual(rel.friends.map((e) => e.user.username).sort(), ['dan', 'eve']);
  assert.equal(rel.friends.find((e) => e.user.username === 'dan').mine, true, 'we sent that one');
  assert.equal(social.relationTo('u-bob', rel).kind, 'received');
  assert.equal(social.relationTo('u-carol', rel).kind, 'sent');
  assert.equal(social.relationTo('u-eve', rel).kind, 'friends');
  assert.equal(social.relationTo('u-zed', rel).kind, 'none');
  assert.equal(social.relationTo(ME, rel).kind, 'self');
});

test('sending a request: new one is posted; an incoming one is accepted instead; a duplicate does nothing', async () => {
  const calls = [];
  social.setTransport(net(calls));
  const rel = await social.relations();
  calls.length = 0;
  await social.sendRequest('u-zed', rel);
  assert.deepEqual(calls.map((c) => [c.method, c.path, c.body && c.body.to_user]), [['POST', 'nutri_friend_requests', 'u-zed']]);
  calls.length = 0;
  await social.sendRequest('u-bob', rel);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'PATCH');
  assert.equal(calls[0].path, 'nutri_friend_requests?id=eq.r1');
  assert.equal(calls[0].body.status, 'accepted');
  calls.length = 0;
  await social.sendRequest('u-carol', rel);
  await social.sendRequest('u-eve', rel);
  assert.equal(calls.length, 0, 'already sent / already friends');
});

test('saving the profile inserts a new one, updates an existing one, and maps the server answers', async () => {
  const calls = [];
  const server = (existing, status, data) => async (path, opts = {}) => {
    calls.push({ path, method: opts.method || 'GET' });
    if (!opts.method) return { ok: true, status: 200, data: existing ? [existing] : [] };
    return { ok: status < 300, status, data };
  };
  social.setTransport(server(null, 201, [{ user_id: ME, username: 'dana' }]));
  assert.equal((await social.saveMyProfile({ username: '@Dana', displayName: 'Dana' })).username, 'dana');
  assert.deepEqual(calls.map((c) => c.method), ['GET', 'POST'], 'no profile yet: insert');
  calls.length = 0;
  social.setTransport(server({ user_id: ME, username: 'old' }, 200, [{ user_id: ME, username: 'dana2' }]));
  assert.equal((await social.saveMyProfile({ username: 'dana2', displayName: 'Dana' })).username, 'dana2');
  assert.deepEqual(calls.map((c) => c.method), ['GET', 'PATCH'], 'has a profile: update, never an upsert');
  assert.equal(calls[1].path, `nutri_profiles?user_id=eq.${ME}`);
  social.setTransport(server(null, 409, { code: '23505' }));
  assert.equal(await social.saveMyProfile({ username: 'bob', displayName: 'x' }), 'taken');
  social.setTransport(server(null, 400, {}));
  assert.equal(await social.saveMyProfile({ username: 'okname', displayName: 'x' }), 'invalid');
  assert.equal(await social.saveMyProfile({ username: 'no', displayName: 'x' }), 'invalid', 'checked before asking');
  social.setTransport(server(null, 500, {}));
  await assert.rejects(() => social.saveMyProfile({ username: 'dana', displayName: '' }), (e) => e.code === 'unavailable');
  social.setTransport(server(null, 403, { code: '42501' }));
  await assert.rejects(() => social.saveMyProfile({ username: 'dana', displayName: '' }), (e) => e.code === 'not_set_up');
});

test('missing tables are told apart from a server that is just down', async () => {
  const answer = (status, data) => async () => ({ ok: false, status, data });
  for (const [status, data] of [[404, {}], [404, { code: 'PGRST205' }], [400, { code: '42P01' }]]) {
    social.setTransport(answer(status, data));
    await assert.rejects(() => social.myProfile(), (e) => e.code === 'not_set_up', `${status} ${JSON.stringify(data)}`);
  }
  social.setTransport(answer(503, {}));
  await assert.rejects(() => social.findByUsername('bob'), (e) => e.code === 'unavailable');
});

test('sending again after the other person declined: the old declined row is cleared and a new request is sent', async () => {
  const calls = [];
  let posts = 0;
  social.setTransport(async (path, opts = {}) => {
    calls.push({ path, method: opts.method || 'GET' });
    if (opts.method === 'POST') { posts++; return posts === 1 ? { ok: false, status: 409, data: { code: '23505' } } : { ok: true, status: 201, data: null }; }
    if (opts.method === 'DELETE') return { ok: true, status: 200, data: [{ id: 'old' }] };
    return { ok: true, status: 200, data: [] };
  });
  await social.sendRequest('u-zed', { friends: [], outgoing: [], incoming: [] });
  assert.deepEqual(calls.map((c) => c.method), ['POST', 'DELETE', 'POST']);
  assert.match(calls[1].path, /from_user=eq\.u-me&to_user=eq\.u-zed&status=eq\.declined/);
  // a pending or accepted one (nothing declined to clear): still counts as sent, no second POST
  calls.length = 0;
  posts = 0;
  social.setTransport(async (path, opts = {}) => {
    calls.push({ method: opts.method || 'GET' });
    if (opts.method === 'POST') return { ok: false, status: 409, data: { code: '23505' } };
    return { ok: true, status: 200, data: [] };
  });
  assert.equal(await social.sendRequest('u-zed', { friends: [], outgoing: [], incoming: [] }), true);
  assert.deepEqual(calls.map((c) => c.method), ['POST', 'DELETE']);
});
