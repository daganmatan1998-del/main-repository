// The first screen a new person sees: sign in, create an account, or carry on
// as a guest (everything stays on this device; they can sign in later from
// Profile). Shown only when accounts are available, nobody is signed in, and
// the person hasn't already chosen "guest" on this device.
//
// "Sign in" and "create account" both go through Google — Google doesn't ask
// which one you meant. The difference is what happens after: signing in
// expects data in the account and restores it; creating an account expects
// none and starts the registration.

import { t as tr } from '../i18n.js';
import { h, clear } from '../util.js';
import { cloudReady, signedIn } from '../cloud.js';
import { googleButton } from './account.js';
import { languageBar } from './language.js';

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
    languageBar(),
    h('img', { src: 'icons/icon-512.png', alt: '', class: 'welcome-logo', width: 96, height: 96 }),
    h('h1', null, tr('Nutri')),
    h('p', { class: 'lead' }, tr('A personal nutrition plan, a daily menu and progress tracking.')),
    h('div', { class: 'entry-actions' },
      googleButton(tr('Sign in'), { intent: 'login', id: 'entry-login', primary: true }),
      googleButton(tr('Create an account'), { intent: 'signup', id: 'entry-signup' }),
      h('button', { type: 'button', class: 'btn btn-ghost btn-block', id: 'entry-guest', onclick: chooseGuest }, tr('Continue without an account'))),
    h('p', { class: 'muted small entry-note' }, tr('With an account your data is also kept in the cloud, and you can change phones without losing anything. Sign-in is through Google. Without an account everything is kept only on this device, and you can always sign in later from Profile.'))));
}
