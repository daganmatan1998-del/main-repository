// Cloud account UI: the Google sign-in button, the account card in Profile,
// the "which copy do we keep?" question and signing out.

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

export function googleButton(label = 'התחברות עם Google') {
  const msg = h('p', { class: 'muted small center', 'aria-live': 'polite' });
  const btn = h('button', {
    type: 'button', class: 'btn btn-block btn-google', id: 'btn-google',
    onclick: async () => {
      if (!cloud.cloudReady()) { msg.textContent = 'ההתחברות עוד לא הוגדרה באפליקציה.'; return; }
      if (!navigator.onLine) { msg.textContent = 'צריך חיבור לאינטרנט כדי להתחבר.'; return; }
      btn.disabled = true;
      msg.textContent = 'מעביר להתחברות…';
      try { await cloud.signIn(); } catch { btn.disabled = false; msg.textContent = 'לא הצלחנו להתחיל את ההתחברות. נסו שוב.'; }
    },
  }, googleLogo(), h('span', null, label));
  return h('div', { class: 'google-wrap' }, btn, msg);
}

const ERRORS = {
  offline: 'אין חיבור — הסנכרון ימשיך כשהחיבור יחזור.',
  signed_out: 'פג תוקף ההתחברות. התחברו שוב.',
};

export function accountCard() {
  if (!cloud.signedIn()) {
    return h('section', { class: 'card', id: 'account-card' },
      h('h2', null, 'גיבוי וחשבון'),
      h('p', { class: 'muted small' }, 'מתחברים עם Google והנתונים נשמרים בחשבון שלך — אפשר להחליף טלפון או להיכנס ממכשיר אחר בלי לאבד כלום.'),
      googleButton());
  }
  const u = cloud.currentUser();
  const st = syncStatus();
  const line = st.busy ? 'מסנכרן…'
    : st.conflict ? 'מחכה לבחירה שלך: איזה עותק לשמור.'
      : st.error ? (ERRORS[st.error] || 'הסנכרון נכשל. ננסה שוב בקרוב.')
        : st.syncedAt ? `מסונכרן · עודכן ${syncedAgo(st.syncedAt)}` : 'ממתין לסנכרון ראשון…';
  const backup = h('input', {
    type: 'checkbox', role: 'switch', id: 'photo-backup', checked: !!state.settings.photoBackup,
    onchange: async (e) => {
      const on = e.target.checked;
      await saveSettings({ photoBackup: on });
      toast(on ? 'גיבוי התמונות הופעל' : 'גיבוי התמונות כובה — העותקים בענן יימחקו');
    },
  });
  return h('section', { class: 'card', id: 'account-card' },
    h('div', { class: 'row space' },
      h('h2', null, 'גיבוי וחשבון'),
      h('span', { class: `badge ${st.error ? 'locked' : 'active'}` }, st.error ? 'לא מסונכרן' : 'מחובר')),
    h('p', { class: 'small', id: 'account-user' }, icon('check', 14), ' ', u.email || u.name || 'מחובר עם Google'),
    h('p', { class: 'muted small', id: 'sync-line', 'aria-live': 'polite' }, line),
    st.conflict ? h('button', { class: 'btn btn-primary btn-block', onclick: openConflict }, 'בחירת עותק') : null,
    h('label', { class: 'switch-row' },
      h('span', null, h('strong', null, 'גיבוי תמונות ההתקדמות'),
        h('small', { class: 'muted' }, 'כבוי: התמונות נשמרות רק במכשיר. דולק: נשמרות גם בחשבון שלך, פרטיות — רק לך יש גישה.')),
      backup),
    h('div', { class: 'grid2' },
      h('button', { class: 'btn', id: 'btn-sync', disabled: st.busy, onclick: async () => { const r = await syncNow(); if (r.conflict) openConflict(); else if (!r.error) toast('הנתונים מסונכרנים'); } }, 'סנכרון עכשיו'),
      h('button', { class: 'btn btn-ghost', id: 'btn-signout', onclick: openSignOut }, 'התנתקות')));
}

function syncedAgo(at) {
  const min = Math.round((Date.now() - at) / 60000);
  if (min < 1) return 'עכשיו';
  if (min < 60) return `לפני ${min} דק׳`;
  const d = new Date(at);
  return `${fmtDate(d.toISOString().slice(0, 10))} ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;
}

// Sync status changes redraw only the account card, so a form being filled in
// elsewhere on the profile screen keeps its input.
window.addEventListener('app:sync', () => {
  const el = document.getElementById('account-card');
  if (el) el.replaceWith(accountCard());
});

// Both this device and the account have data that were never synced together.
export function openConflict() {
  sheet('יש נתונים גם בחשבון וגם במכשיר', (close) => {
    const choose = async (choice) => {
      close();
      const r = await resolveConflict(choice);
      toast(r && r.error ? 'הסנכרון נכשל. נסו שוב.' : choice === 'cloud' ? 'הנתונים מהחשבון נטענו' : 'הנתונים מהמכשיר נשמרו בחשבון');
    };
    return h('div', { class: 'form', id: 'conflict' },
      h('p', null, 'בחשבון הזה כבר שמורים נתונים מתוכנית אחרת. איזה עותק לשמור? העותק השני יוחלף.'),
      h('button', { class: 'btn btn-primary btn-block', id: 'keep-cloud', onclick: () => choose('cloud') }, 'לטעון את הנתונים מהחשבון'),
      h('button', { class: 'btn btn-block', id: 'keep-device', onclick: () => choose('device') }, 'לשמור את הנתונים מהמכשיר הזה'));
  });
}

function openSignOut() {
  sheet('התנתקות', (close) => h('div', { class: 'form' },
    h('p', null, 'הנתונים נשארים שמורים בחשבון. אפשר להשאיר אותם גם במכשיר, או למחוק אותם מהמכשיר (למשל במכשיר שאינו שלך).'),
    h('button', {
      class: 'btn btn-block', id: 'signout-keep',
      onclick: async () => { await cloud.signOut(); close(); toast('התנתקת. הנתונים נשארו במכשיר.'); window.dispatchEvent(new Event('app:rerender')); },
    }, 'התנתקות, הנתונים נשארים במכשיר'),
    h('button', {
      class: 'btn btn-danger btn-block', id: 'signout-wipe',
      onclick: async () => {
        await cloud.signOut();
        try { await wipe(); } catch { toast('המחיקה נחסמה — סגרו לשוניות אחרות של האפליקציה ונסו שוב.'); return; }
        close();
        location.hash = '';
        location.reload();
      },
    }, 'התנתקות ומחיקת הנתונים מהמכשיר')));
}
