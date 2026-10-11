// Asking for permission to send messages: one plain question, approve or not.
// Shown once, right after the person finishes setting up (their first visit to
// Today), and again from Profile. It deliberately doesn't say what will be sent.

import { h, sheet, toast } from '../util.js';
import { state, saveSettings } from '../store.js';
import { enablePush, serverReady, pushSupported, needsInstall } from '../push.js';

const RESULT_TEXT = {
  on: 'מעולה, ההודעות פועלות.',
  denied: 'ההתראות חסומות. אפשר לאשר אותן בהגדרות הדפדפן או המכשיר.',
  unsupported: 'המכשיר הזה לא תומך בהתראות מהאפליקציה.',
  unavailable: 'ההודעות עוד לא זמינות. צריך להעלות את האפליקציה מחדש.',
  failed: 'משהו השתבש בהפעלת התזכורות. נסו שוב.',
};

export function openRemindersSheet({ onDone, asking = false } = {}) {
  // Closing the sheet any other way than "yes" counts as "not now" (asked once).
  return sheet('הודעות', (close) => {
    const msg = h('p', { class: 'muted small center', 'aria-live': 'polite' });
    const body = h('div', { class: 'form', id: 'reminders-sheet' },
      h('p', { class: 'lead' }, 'מאשרים לנוטרי לשלוח לכם הודעות?'));
    if (needsInstall()) {
      body.appendChild(h('div', { class: 'notice warn small' }, 'באייפון התזכורות עובדות רק אחרי שמוסיפים את האפליקציה למסך הבית: כפתור השיתוף ← "הוספה למסך הבית", ופותחים אותה משם.'));
      body.appendChild(h('button', { class: 'btn btn-block', id: 'push-later', onclick: () => close() }, 'הבנתי'));
      return body;
    }
    const yes = h('button', {
      class: 'btn btn-primary btn-block', id: 'push-yes',
      onclick: async () => {
        yes.disabled = true;
        const r = await enablePush();
        await saveSettings({ pushAsked: true });
        if (r === 'on') { close(); toast(RESULT_TEXT.on); if (onDone) onDone(r); return; }
        msg.textContent = RESULT_TEXT[r] || RESULT_TEXT.failed;
        yes.disabled = false;
        yes.textContent = 'נסו שוב';
      },
    }, 'מאשר');
    body.append(yes,
      h('button', { class: 'btn btn-ghost btn-block', id: 'push-later', onclick: async () => { await saveSettings({ pushAsked: true }); close(); } }, 'לא מאשר'),
      msg);
    return body;
  }, { onClose: () => { if (asking && !needsInstall() && !state.settings.push) saveSettings({ pushAsked: true }); } });
}

// Once, after registration: only where reminders can work and the server has them.
let asking = false;
let shown = false;
export async function maybeAskReminders() {
  if (asking || shown || state.settings.pushAsked || state.settings.push) return;
  if (!pushSupported() && !needsInstall()) return;
  if (!needsInstall() && Notification.permission === 'denied') { await saveSettings({ pushAsked: true }); return; }
  asking = true;
  try {
    if (!(await serverReady())) return;
    // iPhone in the browser: explain once, ask again after installing.
    if (needsInstall()) {
      if (state.settings.pushInstallHint) return;
      await saveSettings({ pushInstallHint: true });
    }
    shown = true;
    openRemindersSheet({ asking: true });
  } finally {
    asking = false;
  }
}
