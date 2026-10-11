// The first screen a new person sees: sign in, create an account, or carry on
// as a guest (everything stays on this device; they can sign in later from
// Profile). Shown only when accounts are available, nobody is signed in, and
// the person hasn't already chosen "guest" on this device.
//
// "Sign in" and "create account" both go through Google — Google doesn't ask
// which one you meant. The difference is what happens after: signing in
// expects data in the account and restores it; creating an account expects
// none and starts the registration.

import { h, clear } from '../util.js';
import { cloudReady, signedIn } from '../cloud.js';
import { googleButton } from './account.js';

const KEY = 'nutri-entry';

export const entryNeeded = () => {
  if (!cloudReady() || signedIn()) return false;
  try { return localStorage.getItem(KEY) !== 'guest'; } catch { return false; }
};

export function chooseGuest() {
  try { localStorage.setItem(KEY, 'guest'); } catch { /* storage unavailable: the choice just won't stick */ }
  window.dispatchEvent(new Event('app:rerender'));
}

// Back to the three choices (from the guest welcome screen).
export function backToEntry() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  window.dispatchEvent(new Event('app:rerender'));
}

export function renderEntry(root) {
  clear(root);
  root.appendChild(h('div', { class: 'welcome entry', id: 'entry' },
    h('img', { src: 'icons/icon-512.png', alt: '', class: 'welcome-logo', width: 96, height: 96 }),
    h('h1', null, 'נוטרי'),
    h('p', { class: 'lead' }, 'תוכנית תזונה אישית, תפריט יומי ומעקב התקדמות.'),
    h('div', { class: 'entry-actions' },
      googleButton('התחברות', { intent: 'login', id: 'entry-login', primary: true }),
      googleButton('יצירת חשבון', { intent: 'signup', id: 'entry-signup' }),
      h('button', { type: 'button', class: 'btn btn-ghost btn-block', id: 'entry-guest', onclick: chooseGuest }, 'המשך ללא חשבון')),
    h('p', { class: 'muted small entry-note' }, 'עם חשבון הנתונים שלך נשמרים גם בענן, ואפשר להחליף טלפון בלי לאבד כלום. ההתחברות היא דרך Google. ללא חשבון הכול נשמר רק במכשיר הזה, ותמיד אפשר להתחבר מאוחר יותר מהפרופיל.')));
}
