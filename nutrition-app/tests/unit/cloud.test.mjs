import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { b64url, pkcePair, authorizeUrl, sessionFrom, cloudReady } from '../../www/js/cloud.js';

test('base64url has no padding or +/', () => {
  assert.equal(b64url(new Uint8Array([251, 255, 191])), '-_-_');
  assert.equal(b64url(new Uint8Array([1])), 'AQ');
});

test('PKCE challenge is the S256 of the verifier', async () => {
  const { verifier, challenge } = await pkcePair();
  assert.match(verifier, /^[A-Za-z0-9_-]{64}$/);
  const expected = createHash('sha256').update(verifier).digest('base64url');
  assert.equal(challenge, expected);
  const again = await pkcePair();
  assert.notEqual(again.verifier, verifier, 'a fresh verifier every time');
});

test('authorize URL asks Supabase for Google with PKCE and our return address', () => {
  const u = new URL(authorizeUrl({ url: 'https://abc.supabase.co', redirect: 'https://nutri.example/', challenge: 'xyz' }));
  assert.equal(u.origin + u.pathname, 'https://abc.supabase.co/auth/v1/authorize');
  assert.equal(u.searchParams.get('provider'), 'google');
  assert.equal(u.searchParams.get('redirect_to'), 'https://nutri.example/');
  assert.equal(u.searchParams.get('code_challenge'), 'xyz');
  assert.equal(u.searchParams.get('code_challenge_method'), 's256');
});

test('session keeps tokens, expiry and the display name only', () => {
  const s = sessionFrom({ access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { id: 'u1', email: 'x@y.z', user_metadata: { full_name: 'דנה כהן', avatar_url: 'http://…' } } }, 1000);
  assert.deepEqual(s, { access_token: 'a', refresh_token: 'r', expires_at: 1000 + 3600000, user: { id: 'u1', email: 'x@y.z', name: 'דנה כהן' } });
});

test('cloud is off until both the URL and the key are set', () => {
  assert.equal(cloudReady({ url: '', anonKey: '' }), false);
  assert.equal(cloudReady({ url: 'https://a.supabase.co', anonKey: '' }), false);
  assert.equal(cloudReady({ url: 'https://a.supabase.co', anonKey: 'k' }), true);
});
