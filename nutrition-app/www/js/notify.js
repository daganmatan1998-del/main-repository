// Weekly check-in reminders.
//
// The web has no reliable way to schedule a local notification for a future
// date, so reminders are layered:
//  1. Periodic Background Sync (Chrome/Edge/Android, installed PWA): the
//     service worker wakes about twice a day and notifies when a check-in is due.
//  2. A weekly recurring calendar event (.ics) — works everywhere, including iOS.
// When wrapped with Capacitor, swap this module for @capacitor/local-notifications.

import { saveSettings } from './store.js';
import { addDays } from './util.js';

export const supported = () => 'Notification' in window && 'serviceWorker' in navigator;

export async function enableReminders() {
  if (!supported()) return 'unsupported';
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    await saveSettings({ reminders: false });
    return perm;
  }
  await saveSettings({ reminders: true });
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) {
      await reg.periodicSync.register('checkin-reminder', { minInterval: 12 * 3600 * 1000 });
    }
  } catch { /* periodic sync is best-effort (needs install + engagement) */ }
  return 'granted';
}

export async function disableReminders() {
  await saveSettings({ reminders: false });
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) await reg.periodicSync.unregister('checkin-reminder');
  } catch { /* nothing registered */ }
}

function icsDate(day) {
  return day.replace(/-/g, '');
}

// Weekly recurring all-day event starting at the next due date, with a 9:00 alarm.
export function downloadCalendar(regDay, currentWeek) {
  const first = addDays(regDay, (currentWeek + 1) * 7);
  const end = addDays(first, 1);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Nutri//Weekly check-in//HE',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:nutri-weekly-${regDay}@nutri.app`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${icsDate(first)}`,
    `DTEND;VALUE=DATE:${icsDate(end)}`,
    'RRULE:FREQ=WEEKLY',
    'SUMMARY:צילום התקדמות שבועי + שקילה',
    'DESCRIPTION:פתחו את האפליקציה, צלמו תמונת התקדמות ועדכנו משקל ואחוז שומן.',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:צילום התקדמות שבועי',
    'TRIGGER:PT9H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'weekly-checkin.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
