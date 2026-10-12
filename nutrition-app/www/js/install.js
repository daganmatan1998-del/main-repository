// "Add to Home Screen" handling. Chromium browsers fire beforeinstallprompt,
// which we keep and replay from our own button. iOS Safari has no such event,
// so there we show the manual Share → Add to Home Screen instructions.

import { t as tr } from './i18n.js';
import { h, icon, toast, sheet } from './util.js';
import { saveSettings } from './store.js';

let deferred = null;
const listeners = new Set();

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  listeners.forEach((fn) => fn());
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  toast(tr('The app is installed 🎉'));
  listeners.forEach((fn) => fn());
});

export const onInstallChange = (fn) => listeners.add(fn);

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export const canInstall = () => !isStandalone() && (!!deferred || isIOS());

export async function promptInstall() {
  if (deferred) {
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    return outcome;
  }
  if (isIOS()) {
    sheet(tr('Install on iPhone'), h('ol', { class: 'ios-steps' },
      h('li', null, tr('Tap the share button '), h('b', null, '⬆︎'), tr(' at the bottom of Safari')),
      h('li', null, tr('Choose '), h('b', null, tr('"Add to Home Screen"'))),
      h('li', null, tr('Tap '), h('b', null, tr('"Add"')), tr(' — and the app appears as an icon'))));
    return 'ios';
  }
  toast(tr('Installation is available from the browser menu → "Install app"'));
  return 'manual';
}

export function installCard() {
  if (!canInstall()) return null;
  return h('section', { class: 'card install-card', id: 'install-card' },
    h('div', { class: 'row gap center-y' },
      h('img', { src: 'icons/icon-192.png', alt: '', width: 44, height: 44, class: 'app-icon' }),
      h('div', { class: 'grow' },
        h('strong', null, tr('Install the app')),
        h('p', { class: 'muted small' }, tr('Quick access from your home screen, full screen, and it works without internet.')))),
    h('div', { class: 'row gap' },
      h('button', { class: 'btn btn-primary', onclick: () => promptInstall() }, icon('download', 18), tr('Install')),
      h('button', { class: 'btn btn-ghost', onclick: () => saveSettings({ installDismissed: true }) }, tr('Not now'))));
}
