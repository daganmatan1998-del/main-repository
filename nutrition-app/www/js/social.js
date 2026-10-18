// Friends: a public profile with a username, friend requests, and the invite
// link (#/u/<username>) that opens a person's profile — shared by WhatsApp,
// copied, or typed in the search box. Tables and rules: supabase/setup.sql.
//
// Everything here is pure except `net`, the transport (cloud.rest in the app),
// so the tests run it against an in-memory fake.

import * as cloud from './cloud.js';

let net = (...a) => cloud.rest(...a);
export const setTransport = (fn) => { net = fn; };
let me = () => cloud.userId();
export const setMe = (fn) => { me = fn; };

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

// What the person typed, as a username: no @, no spaces, lower case.
export const normalizeUsername = (s) => String(s || '').trim().replace(/^@+/, '').toLowerCase();
export const validUsername = (s) => USERNAME_RE.test(s);

// ---- the invite link ----
export const linkFor = (username, base = `${location.origin}${location.pathname}`) => `${base}#/u/${username}`;
export const whatsappUrl = (text, link) => `https://wa.me/?text=${encodeURIComponent(`${text}\n${link}`)}`;
// The username in a hash like "#/u/dana", or null.
export function usernameFromHash(hash) {
  const m = /^#\/u\/([A-Za-z0-9_@]{1,30})\/?$/.exec(hash || '');
  return m ? normalizeUsername(m[1]) : null;
}

// ---- profiles ----
const PROFILE_FIELDS = 'user_id,username,display_name,wins,losses';

export async function myProfile() {
  const id = me();
  if (!id) return null;
  const r = await net(`nutri_profiles?select=${PROFILE_FIELDS}&user_id=eq.${id}`);
  if (!r.ok) throw new Error('unavailable');
  return r.data[0] || null;
}

// 'taken' | 'invalid' | profile
export async function saveMyProfile({ username, displayName }) {
  const id = me();
  const name = normalizeUsername(username);
  if (!validUsername(name)) return 'invalid';
  const r = await net('nutri_profiles?on_conflict=user_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: { user_id: id, username: name, display_name: String(displayName || '').trim().slice(0, 40) },
  });
  if (r.status === 409 || (r.data && r.data.code === '23505')) return 'taken';
  if (r.status === 400) return 'invalid';
  if (!r.ok) throw new Error('unavailable');
  return (Array.isArray(r.data) ? r.data[0] : r.data) || null;
}

export async function findByUsername(username) {
  const name = normalizeUsername(username);
  if (!validUsername(name)) return null;
  const r = await net(`nutri_profiles?select=${PROFILE_FIELDS}&username=eq.${name}`);
  if (!r.ok) throw new Error('unavailable');
  return r.data[0] || null;
}

async function profilesByIds(ids) {
  if (!ids.length) return {};
  const r = await net(`nutri_profiles?select=${PROFILE_FIELDS}&user_id=in.(${ids.join(',')})`);
  if (!r.ok) throw new Error('unavailable');
  return Object.fromEntries(r.data.map((p) => [p.user_id, p]));
}

// Share of finished challenges won, 0–100, or null before any.
export const winRate = (p) => (p && p.wins + p.losses > 0 ? Math.round((100 * p.wins) / (p.wins + p.losses)) : null);

// ---- friend requests ----
// { incoming, outgoing, friends }: each entry { id, status, at, user: profile }.
export async function relations() {
  const mine = me();
  const r = await net(`nutri_friend_requests?select=id,from_user,to_user,status,created_at,updated_at&or=(from_user.eq.${mine},to_user.eq.${mine})&order=created_at.desc&limit=200`);
  if (!r.ok) throw new Error('unavailable');
  const rows = r.data.filter((x) => x.status !== 'declined' || x.to_user === mine);
  const others = [...new Set(rows.map((x) => (x.from_user === mine ? x.to_user : x.from_user)))];
  const people = await profilesByIds(others);
  const entry = (x) => ({ id: x.id, status: x.status, at: x.updated_at || x.created_at, user: people[x.from_user === mine ? x.to_user : x.from_user] || null, mine: x.from_user === mine });
  const all = rows.map(entry).filter((e) => e.user);
  return {
    incoming: all.filter((e) => !e.mine && e.status === 'pending'),
    outgoing: all.filter((e) => e.mine && e.status === 'pending'),
    friends: all.filter((e) => e.status === 'accepted'),
  };
}

// 'self' | 'friends' | 'sent' | 'received' | 'none' — and the request, if any.
export function relationTo(userId, rel) {
  if (userId === me()) return { kind: 'self' };
  const f = rel.friends.find((e) => e.user.user_id === userId);
  if (f) return { kind: 'friends', request: f };
  const o = rel.outgoing.find((e) => e.user.user_id === userId);
  if (o) return { kind: 'sent', request: o };
  const i = rel.incoming.find((e) => e.user.user_id === userId);
  if (i) return { kind: 'received', request: i };
  return { kind: 'none' };
}

// A request from them already waiting is accepted instead of a second one sent.
export async function sendRequest(toUserId, rel) {
  const rel0 = relationTo(toUserId, rel);
  if (rel0.kind === 'received') return respond(rel0.request.id, 'accepted');
  if (rel0.kind !== 'none') return true;
  const r = await net('nutri_friend_requests', { method: 'POST', prefer: 'return=minimal', body: { from_user: me(), to_user: toUserId } });
  if (r.status === 409) return true; // already sent
  if (!r.ok) throw new Error('unavailable');
  return true;
}

export async function respond(id, status) {
  const r = await net(`nutri_friend_requests?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status, updated_at: new Date().toISOString() } });
  if (!r.ok) throw new Error('unavailable');
  return true;
}

// Cancels a sent request, or ends a friendship (either side).
export async function removeRequest(id) {
  const r = await net(`nutri_friend_requests?id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' });
  if (!r.ok) throw new Error('unavailable');
  return true;
}
