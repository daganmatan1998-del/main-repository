// "Add to Home Screen" handling. Chromium browsers fire beforeinstallprompt,
// which we keep and replay from our own button. iOS Safari has no such event,
// so there we show the manual Share → Add to Home Screen instructions.

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
  toast('האפליקציה הותקנה 🎉');
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
    sheet('התקנה באייפון', h('ol', { class: 'ios-steps' },
      h('li', null, 'לחצו על כפתור השיתוף ', h('b', null, '⬆︎'), ' בתחתית Safari'),
      h('li', null, 'בחרו ', h('b', null, '"הוספה למסך הבית"')),
      h('li', null, 'לחצו ', h('b', null, '"הוסף"'), ' — והאפליקציה תופיע כאייקון')));
    return 'ios';
  }
  toast('ההתקנה זמינה מתפריט הדפדפן ← "התקנת אפליקציה"');
  return 'manual';
}

export function installCard() {
  if (!canInstall()) return null;
  return h('section', { class: 'card install-card', id: 'install-card' },
    h('div', { class: 'row gap center-y' },
      h('img', { src: 'icons/icon-192.png', alt: '', width: 44, height: 44, class: 'app-icon' }),
      h('div', { class: 'grow' },
        h('strong', null, 'התקינו את האפליקציה'),
        h('p', { class: 'muted small' }, 'גישה מהירה ממסך הבית, מסך מלא ועבודה גם בלי אינטרנט.'))),
    h('div', { class: 'row gap' },
      h('button', { class: 'btn btn-primary', onclick: () => promptInstall() }, icon('download', 18), 'התקנה'),
      h('button', { class: 'btn btn-ghost', onclick: () => saveSettings({ installDismissed: true }) }, 'לא עכשיו')));
}
