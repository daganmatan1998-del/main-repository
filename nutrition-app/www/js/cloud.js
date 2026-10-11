// Cloud account: sign in with Google and keep a copy of the user's data in
// their own private corner of the cloud (Supabase: Auth + Postgres + Storage).
//
// No SDK: the three Supabase APIs used here are plain HTTPS, and the app has
// no build step to bundle a library with. Sign-in is OAuth with PKCE, so the
// browser never handles a client secret:
//   1. signIn() sends the user to Google (via Supabase) with a code challenge,
//   2. Google sends them back to the app with ?code=…,
//   3. finishSignIn() trades the code + verifier for a session.
//
// Security: the anon key in config.js is public by design. What protects the
// data is the database's row-level security (supabase/setup.sql): a signed-in
// user can read and write only their own row and their own folder of files.

import { CLOUD } from './config.js';
import * as db from './db.js';

export class CloudError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

export const cloudReady = (cfg = CLOUD) => !!(cfg.url && cfg.anonKey);

const VERIFIER_KEY = 'nutri-pkce';
const RETURN_KEY = 'nutri-return';
const BUCKET = 'nutri';

let session = null; // { access_token, refresh_token, expires_at, user: { id, email, name } }

export async function loadSession() {
  session = (await db.kv.get('session').catch(() => null)) || null;
  return session;
}

export const currentUser = () => (session ? session.user : null);
export const signedIn = () => !!session;

// ---------- PKCE (pure; unit-tested) ----------

export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function pkcePair(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  const verifier = b64url(random(48));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

export function authorizeUrl({ url, redirect, challenge }) {
  const u = new URL(`${url}/auth/v1/authorize`);
  u.searchParams.set('provider', 'google');
  u.searchParams.set('redirect_to', redirect);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 's256');
  return u.toString();
}

// The session the app keeps, from Supabase's token response.
export function sessionFrom(data, now = Date.now()) {
  const meta = (data.user && data.user.user_metadata) || {};
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: now + (Number(data.expires_in) || 3600) * 1000,
    user: { id: data.user.id, email: data.user.email || '', name: meta.full_name || meta.name || '' },
  };
}

// ---------- sign in / out ----------

export async function signIn() {
  if (!cloudReady()) throw new CloudError('not_configured');
  const { verifier, challenge } = await pkcePair();
  try {
    localStorage.setItem(VERIFIER_KEY, verifier);
    localStorage.setItem(RETURN_KEY, location.hash || '#/today');
  } catch {
    throw new CloudError('storage_unavailable');
  }
  location.assign(authorizeUrl({ url: CLOUD.url, redirect: location.origin + location.pathname, challenge }));
}

// Runs at startup. Returns null when this page load isn't a return from
// Google, else { ok } or { error }.
export async function finishSignIn() {
  const q = new URLSearchParams(location.search);
  const code = q.get('code');
  const error = q.get('error_description') || q.get('error');
  if (!code && !error) return null;
  let verifier = null;
  let back = '#/today';
  try {
    verifier = localStorage.getItem(VERIFIER_KEY);
    back = localStorage.getItem(RETURN_KEY) || back;
    localStorage.removeItem(VERIFIER_KEY);
    localStorage.removeItem(RETURN_KEY);
  } catch { /* storage unavailable: verifier stays null */ }
  // Drop ?code from the address bar so a refresh doesn't replay it.
  history.replaceState(null, '', location.pathname + back);
  if (error) return { error: 'denied' };
  if (!verifier || !cloudReady()) return { error: 'expired' };
  try {
    const data = await authCall('token?grant_type=pkce', { auth_code: code, code_verifier: verifier });
    await saveSession(sessionFrom(data));
    return { ok: true };
  } catch (e) {
    return { error: e.code || 'failed' };
  }
}

export async function signOut() {
  const s = session;
  await saveSession(null);
  if (s) {
    fetch(`${CLOUD.url}/auth/v1/logout`, { method: 'POST', headers: { apikey: CLOUD.anonKey, authorization: `Bearer ${s.access_token}` } }).catch(() => {});
  }
}

async function saveSession(s) {
  session = s;
  if (s) await db.kv.set('session', s); else await db.kv.del('session').catch(() => {});
}

async function authCall(path, body) {
  let res;
  try {
    res = await fetch(`${CLOUD.url}/auth/v1/${path}`, {
      method: 'POST',
      headers: { apikey: CLOUD.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CloudError('offline');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.access_token) throw new CloudError(res.status >= 500 ? 'unavailable' : 'auth_failed', res.status);
  return data;
}

// A valid access token, refreshed a minute before it expires. A refresh token
// the server no longer accepts signs the user out (the data stays on the device).
async function token() {
  if (!session) throw new CloudError('signed_out');
  if (session.expires_at - 60000 > Date.now()) return session.access_token;
  try {
    const data = await authCall('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
    await saveSession(sessionFrom(data));
  } catch (e) {
    if (e.code === 'auth_failed') { await saveSession(null); throw new CloudError('signed_out'); }
    throw e;
  }
  return session.access_token;
}

async function api(path, { method = 'GET', headers = {}, body } = {}) {
  const t = await token();
  let res;
  try {
    res = await fetch(`${CLOUD.url}${path}`, { method, headers: { apikey: CLOUD.anonKey, authorization: `Bearer ${t}`, ...headers }, body });
  } catch {
    throw new CloudError('offline');
  }
  if (res.status === 401) { await saveSession(null); throw new CloudError('signed_out', 401); }
  return res;
}

const uid = () => session.user.id;

// ---------- data (one row per user) ----------

export async function pullState() {
  const res = await api(`/rest/v1/nutri_state?select=data&user_id=eq.${uid()}`);
  if (!res.ok) throw new CloudError('unavailable', res.status);
  const rows = await res.json();
  return rows[0] ? rows[0].data : null;
}

export async function pushState(data) {
  const res = await api('/rest/v1/nutri_state?on_conflict=user_id', {
    method: 'POST',
    headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: uid(), data, updated_at: new Date(data.savedAt || Date.now()).toISOString() }),
  });
  if (!res.ok) throw new CloudError('unavailable', res.status);
}

// ---------- files (the user's own folder) ----------

export async function putFile(name, blob) {
  const res = await api(`/storage/v1/object/${BUCKET}/${uid()}/${name}`, {
    method: 'POST',
    headers: { 'content-type': blob.type || 'image/jpeg', 'x-upsert': 'true' },
    body: blob,
  });
  if (!res.ok) throw new CloudError('unavailable', res.status);
}

export async function getFile(name) {
  const res = await api(`/storage/v1/object/authenticated/${BUCKET}/${uid()}/${name}`);
  return res.ok ? res.blob() : null;
}

export async function removeFiles(names) {
  if (!names.length) return;
  const res = await api(`/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prefixes: names.map((n) => `${uid()}/${n}`) }),
  });
  if (!res.ok) throw new CloudError('unavailable', res.status);
}

export async function listFiles(folder) {
  const res = await api(`/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prefix: `${uid()}/${folder}`, limit: 1000 }),
  });
  if (!res.ok) throw new CloudError('unavailable', res.status);
  return (await res.json()).map((f) => `${folder}/${f.name}`);
}

// Deletes everything this user has in the cloud — files, data row and the
// account itself (supabase/setup.sql: delete_my_account) — then signs out.
export async function deleteAccount() {
  const files = [...await listFiles('photos'), ...await listFiles('profile')];
  await removeFiles(files);
  const res = await api('/rest/v1/rpc/delete_my_account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (!res.ok) throw new CloudError('unavailable', res.status);
  await saveSession(null);
}
