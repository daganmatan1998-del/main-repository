// Daily meal reminders on this device (the server half is server/push.js).
//
// The device subscribes to Web Push and tells the server three things: its
// push address, its time zone, and which meals are already marked today (no
// food, no health data), so the server only reminds about a meal that isn't
// marked. The service worker (sw.js) turns each push into a notification.
//
// iPhone: push works only for an installed app (Share, then Add to Home
// Screen) on iOS 16.4 or later.

import { API_BASE } from './config.js';
import { state, today, saveSettings, onSaved } from './store.js';
import { mealTemplate } from './mealplan.js';
import { isStandalone, isIOS } from './install.js';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
// iPhone/iPad in the browser: push is possible only after installing.
export const needsInstall = () => isIOS() && !isStandalone();

const b64uToBytes = (s) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function api(path, body) {
  if (!navigator.onLine) throw new Error('offline'); // no request, so no network error in the console
  const res = await fetch(`${API_BASE}/api/push/${path}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

// Does the server offer reminders (its KV namespace exists)? Cheap, no side effects.
export async function serverReady() {
  try {
    const r = await api('key');
    return r.ok && !!(r.data && r.data.publicKey);
  } catch { return false; }
}

// Which meals are marked today: { day, done: { b, l, d, s }, any }.
export function mealState(day = today()) {
  const eaten = new Set(((state.logs[day] && state.logs[day].eaten) || []));
  const done = { b: false, l: false, d: false, s: false };
  const prefs = (state.profile && state.profile.prefs) || { mealsPerDay: 4 };
  mealTemplate(prefs.mealsPerDay).forEach((m, i) => { if (eaten.has(i) && m.type in done) done[m.type] = true; });
  return { day, done, any: eaten.size > 0 };
}

const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jerusalem'; } catch { return 'Asia/Jerusalem'; } };

let endpoint = '';

async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

// Asks for permission, subscribes and registers with the server.
// Returns 'on' | 'denied' | 'unsupported' | 'install' | 'unavailable' | 'failed'.
export async function enablePush() {
  if (needsInstall()) return 'install';
  if (!pushSupported()) return 'unsupported';
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') { await saveSettings({ push: false }); return 'denied'; }
  try {
    const key = await api('key');
    if (!key.ok) return 'unavailable';
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key.data.publicKey) });
    endpoint = sub.endpoint;
    const r = await api('subscribe', { endpoint, tz: tz(), state: { ...mealState(), open: true } });
    if (!r.ok) return 'unavailable';
    await saveSettings({ push: true });
    return 'on';
  } catch (e) {
    console.warn('push enable failed', e);
    return 'failed';
  }
}

export async function disablePush() {
  await saveSettings({ push: false });
  try {
    const sub = await currentSubscription();
    if (sub) {
      await api('unsubscribe', { endpoint: sub.endpoint, tz: tz() }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch { /* nothing subscribed */ }
  endpoint = '';
}

// Tells the server which meals are marked (and that the app is open).
let lastSent = '';
export async function syncPushState({ open = false } = {}) {
  if (!state.settings.push || !pushSupported() || Notification.permission !== 'granted') return;
  try {
    if (!endpoint) { const sub = await currentSubscription(); if (!sub) return; endpoint = sub.endpoint; }
    const st = mealState();
    const sig = JSON.stringify(st);
    if (!open && sig === lastSent) return;
    lastSent = sig;
    const r = await api('state', { endpoint, tz: tz(), state: { ...st, ...(open ? { open: true } : {}) } });
    // The server lost this device (e.g. reminders were reset): register it again.
    if (r.status === 404) await api('subscribe', { endpoint, tz: tz(), state: { ...st, open: true } });
  } catch { /* offline: the next change sends it */ }
}

// At startup: listen for changes (they are sent only while reminders are on),
// keep an enabled subscription alive, drop it if permission was withdrawn.
export async function startPush() {
  let timer = null;
  onSaved(() => { clearTimeout(timer); timer = setTimeout(() => syncPushState(), 2000); });
  // The browser dropped the subscription (the service worker says so): register again.
  navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data && e.data.type === 'PUSH_RESUBSCRIBE' && state.settings.push) enablePush(); });
  let lastOpen = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastOpen > 5 * 60 * 1000) { lastOpen = Date.now(); syncPushState({ open: true }); }
  });
  if (!state.settings.push || !pushSupported()) return;
  if (Notification.permission !== 'granted') { await saveSettings({ push: false }); return; }
  try {
    const sub = await currentSubscription();
    if (!sub) { await enablePush(); return; }
    endpoint = sub.endpoint;
    await api('subscribe', { endpoint, tz: tz(), state: { ...mealState(), open: true } });
  } catch { /* offline */ }
}
