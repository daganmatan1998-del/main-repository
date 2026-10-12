// Cloud account UI: the Google sign-in button, the account card in Profile,
// the "which copy do we keep?" question and signing out.

import { t as tr, locale } from '../i18n.js';
import { h, icon, sheet, toast, fmtDate } from '../util.js';
import * as cloud from '../cloud.js';
import { syncNow, syncStatus, resolveConflict } from '../sync.js';
import { state, saveSettings, wipe } from '../store.js';

// Google's four-colour G, drawn inline (no external image).
function googleLogo() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.8 6.1C12.4 13.6 17.7 9.5 24 9.5z"/>'
    + '<path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"/>'
    + '<path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.8l7.8-6.1z"/>'
    + '<path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.8 6.1C6.6 42.6 14.6 48 24 48z"/>';
  return svg;
}

export function googleButton(label = tr('Sign in with Google'), { intent = 'login', id = 'btn-google', primary = false } = {}) {
  const msg = h('p', { class: 'muted small center', 'aria-live': 'polite' });
  const btn = h('button', {
    type: 'button', class: `btn btn-block btn-google${primary ? ' btn-google-primary' : ''}`, id,
    onclick: async () => {
      if (!cloud.cloudReady()) { msg.textContent = tr('Sign-in is not connected yet — it will open in the next update.'); return; }
      if (!navigator.onLine) { msg.textContent = tr('You need an internet connection to sign in.'); return; }
      btn.disabled = true;
      msg.textContent = tr('Taking you to sign-in…');
      try { await cloud.signIn(intent); } catch { btn.disabled = false; msg.textContent = tr('We couldn\'t start the sign-in. Try again.'); }
    },
  }, googleLogo(), h('span', null, label));
  return h('div', { class: 'google-wrap' }, btn, msg);
}

const ERRORS = {
  offline: tr('No connection — syncing will continue when you are back online.'),
  signed_out: tr('Your sign-in expired. Sign in again.'),
};

export function accountCard() {
  if (!cloud.cloudReady()) {
    // Ready in the app, waiting for the Supabase project (config.js CLOUD).
    return h('section', { class: 'card', id: 'account-card' },
      h('div', { class: 'row space' }, h('h2', null, tr('Backup and account')), h('span', { class: 'badge' }, tr('Soon'))),
      h('p', { class: 'muted small' }, tr('Coming soon: sign in with Google and keep your data in your account, so you can change phones or sign in from another device without losing anything. For now everything is kept on this device.')),
      googleButton());
  }
  if (!cloud.signedIn()) {
    return h('section', { class: 'card', id: 'account-card' },
      h('h2', null, tr('Backup and account')),
      h('p', { class: 'muted small' }, tr('Sign in with Google and your data is kept in your account — change phones or sign in from another device without losing anything.')),
      googleButton());
  }
  const u = cloud.currentUser();
  const st = syncStatus();
  const line = st.busy ? tr('Syncing…')
    : st.conflict ? tr('Waiting for your choice: which copy to keep.')
      : st.error ? (ERRORS[st.error] || tr('Syncing failed. We\'ll try again soon.'))
        : st.syncedAt ? tr('Synced · updated {0}', syncedAgo(st.syncedAt)) : tr('Waiting for the first sync…');
  const backup = h('input', {
    type: 'checkbox', role: 'switch', id: 'photo-backup', checked: !!state.settings.photoBackup,
    onchange: async (e) => {
      const on = e.target.checked;
      await saveSettings({ photoBackup: on });
      toast(on ? tr('Photo backup is on') : tr('Photo backup is off — the copies in the cloud will be deleted'));
    },
  });
  return h('section', { class: 'card', id: 'account-card' },
    h('div', { class: 'row space' },
      h('h2', null, tr('Backup and account')),
      h('span', { class: `badge ${st.error ? 'locked' : 'active'}` }, st.error ? tr('Not synced') : tr('Signed in'))),
    h('p', { class: 'small', id: 'account-user' }, icon('check', 14), ' ', u.email || u.name || tr('Signed in with Google')),
    h('p', { class: 'muted small', id: 'sync-line', 'aria-live': 'polite' }, line),
    st.conflict ? h('button', { class: 'btn btn-primary btn-block', onclick: openConflict }, tr('Choose a copy')) : null,
    h('label', { class: 'switch-row' },
      h('span', null, h('strong', null, tr('Back up progress photos')),
        h('small', { class: 'muted' }, tr('Off: photos stay only on this device. On: they are also kept in your account, private — only you can access them.'))),
      backup),
    h('div', { class: 'grid2' },
      h('button', { class: 'btn', id: 'btn-sync', disabled: st.busy, onclick: async () => { const r = await syncNow(); if (r.conflict) openConflict(); else if (!r.error) toast(tr('Your data is synced')); } }, tr('Sync now')),
      h('button', { class: 'btn btn-ghost', id: 'btn-signout', onclick: openSignOut }, tr('Sign out'))));
}

function syncedAgo(at) {
  const min = Math.round((Date.now() - at) / 60000);
  if (min < 1) return tr('now');
  if (min < 60) return tr('{0} min ago', min);
  const d = new Date(at);
  return `${fmtDate(d.toISOString().slice(0, 10))} ${d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`;
}

// Sync status changes redraw only the account card, so a form being filled in
// elsewhere on the profile screen keeps its input.
window.addEventListener('app:sync', () => {
  const el = document.getElementById('account-card');
  if (el) el.replaceWith(accountCard());
});

// Both this device and the account have data that were never synced together.
export function openConflict() {
  sheet(tr('There is data in both the account and on this device'), (close) => {
    const choose = async (choice) => {
      close();
      const r = await resolveConflict(choice);
      toast(r && r.error ? tr('Syncing failed. Try again.') : choice === 'cloud' ? tr('Your data from the account was loaded') : tr('Your data from this device was saved to the account'));
    };
    return h('div', { class: 'form', id: 'conflict' },
      h('p', null, tr('This account already holds data from another plan. Which copy should we keep? The other copy will be replaced.')),
      h('button', { class: 'btn btn-primary btn-block', id: 'keep-cloud', onclick: () => choose('cloud') }, tr('Load the data from the account')),
      h('button', { class: 'btn btn-block', id: 'keep-device', onclick: () => choose('device') }, tr('Keep this device\'s data')));
  });
}

function openSignOut() {
  sheet(tr('Sign out'), (close) => h('div', { class: 'form' },
    h('p', null, tr('Your data stays saved in your account. You can keep it on this device too, or delete it from this device (for example on a device that is not yours).')),
    h('button', {
      class: 'btn btn-block', id: 'signout-keep',
      onclick: async () => { await cloud.signOut(); close(); toast(tr('Signed out. Your data stayed on this device.')); window.dispatchEvent(new Event('app:rerender')); },
    }, tr('Sign out, keep the data on this device')),
    h('button', {
      class: 'btn btn-danger btn-block', id: 'signout-wipe',
      onclick: async () => {
        await cloud.signOut();
        try { await wipe(); } catch { toast(tr('Deleting was blocked — close other tabs of the app and try again.')); return; }
        close();
        location.hash = '';
        location.reload();
      },
    }, tr('Sign out and delete the data from this device'))));
}
