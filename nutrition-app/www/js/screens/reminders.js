// Asking for permission to send messages: one plain question, approve or not.
// Shown once, right after the person finishes setting up (their first visit to
// Today), and again from Profile. It deliberately doesn't say what will be sent.

import { t as tr } from '../i18n.js';
import { h, sheet, toast } from '../util.js';
import { state, saveSettings } from '../store.js';
import { enablePush, serverReady, pushSupported, needsInstall } from '../push.js';

const RESULT_TEXT = {
  on: tr('Great, messages are on.'),
  denied: tr('Notifications are blocked. You can allow them in the browser or device settings.'),
  unsupported: tr('This device does not support notifications from the app.'),
  unavailable: tr('Messages are not available yet. The app needs to be uploaded again.'),
  failed: tr('Something went wrong turning on reminders. Try again.'),
};

export function openRemindersSheet({ onDone, asking = false } = {}) {
  // Closing the sheet any other way than "yes" counts as "not now" (asked once).
  return sheet(tr('Messages'), (close) => {
    const msg = h('p', { class: 'muted small center', 'aria-live': 'polite' });
    const body = h('div', { class: 'form', id: 'reminders-sheet' },
      h('p', { class: 'lead' }, tr('Do you allow Nutri to send you messages?')));
    if (needsInstall()) {
      body.appendChild(h('div', { class: 'notice warn small' }, tr('On iPhone, reminders work only after you add the app to your home screen: the share button → "Add to Home Screen", and then open it from there.')));
      body.appendChild(h('button', { class: 'btn btn-block', id: 'push-later', onclick: () => close() }, tr('Got it')));
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
        yes.textContent = tr('Try again‖reminders');
      },
    }, tr('Allow'));
    body.append(yes,
      h('button', { class: 'btn btn-ghost btn-block', id: 'push-later', onclick: async () => { await saveSettings({ pushAsked: true }); close(); } }, tr('Don\'t allow')),
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
