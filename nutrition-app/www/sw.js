// Service worker: offline app shell + weekly reminder via Periodic Background Sync.
//
// Strategy: everything the app needs is precached at install. Same-origin GETs
// are served cache-first and refreshed in the background (stale-while-
// revalidate), so the app opens instantly and fully offline. /api/* is never
// cached — the assistant needs a live connection, and its answers are personal.
// All user data lives in IndexedDB, which is unaffected by cache updates.

const VERSION = 'nutri-v1.4.0';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/config.js',
  'js/util.js',
  'js/db.js',
  'js/store.js',
  'js/foods.js',
  'js/nutrition.js',
  'js/mealplan.js',
  'js/substitutions.js',
  'js/schedule.js',
  'js/image.js',
  'js/chart.js',
  'js/chat.js',
  'js/notify.js',
  'js/install.js',
  'js/theme.js',
  'js/components.js',
  'js/screens/onboarding.js',
  'js/screens/photo-picker.js',
  'js/screens/checkin.js',
  'js/screens/today.js',
  'js/screens/plan.js',
  'js/screens/assistant.js',
  'js/screens/gallery.js',
  'js/screens/profile.js',
  'js/screens/period.js',
  'js/screens/food-picker.js',
  'js/screens/shopping.js',
  'js/shopping.js',
  'js/bodyfat.js',
  'js/recipes.js',
  'js/screens/recipes.js',
  'js/screens/bodyfat.js',
  'icons/favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  'fonts/rubik-hebrew-400-normal.woff2',
  'fonts/rubik-hebrew-500-normal.woff2',
  'fonts/rubik-hebrew-700-normal.woff2',
  'fonts/rubik-latin-400-normal.woff2',
  'fonts/rubik-latin-500-normal.woff2',
  'fonts/rubik-latin-700-normal.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
  // First install activates immediately; updates wait for the user to accept.
  if (!self.registration.active) self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('nutri-') && k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) return;

  if (req.mode === 'navigate') {
    // The app is a single page with hash routing: any navigation gets index.html.
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const cached = await cache.match('index.html');
      const network = fetch(req).then((res) => {
        if (res.ok) cache.put('index.html', res.clone());
        return res;
      }).catch(() => null);
      return cached || (await network) || new Response('offline', { status: 503 });
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (cached) {
      event.waitUntil(network);
      return cached;
    }
    return (await network) || new Response('', { status: 504 });
  })());
});

// ---------- weekly reminder ----------
// Mirrors schedule.js: week n is due on day 7n after registration.

function idb(name) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name);
    // Never create the database from here: an empty v1 database would stop the
    // app's own upgrade from creating its stores.
    r.onupgradeneeded = () => r.transaction.abort();
    r.onsuccess = () => {
      // Let "delete all data" proceed instead of being blocked by this connection.
      r.result.onversionchange = () => r.result.close();
      resolve(r.result);
    };
    r.onerror = () => reject(r.error);
  });
}

function read(db, store, key) {
  return new Promise((resolve) => {
    try {
      const t = db.transaction(store, 'readonly');
      const r = key === undefined ? t.objectStore(store).getAll() : t.objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}

function write(db, key, value) {
  return new Promise((resolve) => {
    try {
      const t = db.transaction('kv', 'readwrite');
      t.objectStore('kv').put(value, key);
      t.oncomplete = () => resolve();
      t.onerror = () => resolve();
    } catch { resolve(); }
  });
}

function dayNum(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

function localKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function checkReminder() {
  let db;
  try { db = await idb('nutri'); } catch { return; }
  try {
    const profile = await read(db, 'kv', 'profile');
    const settings = (await read(db, 'kv', 'settings')) || {};
    if (!profile || !settings.reminders) return;
    const week = Math.floor((dayNum(localKey(new Date())) - dayNum(profile.regDay)) / 7);
    if (week < 1 || settings.notifiedWeek === week) return;
    const checkins = (await read(db, 'checkins')) || [];
    if (checkins.some((c) => c.week === week && c.completedAt)) return;
    await self.registration.showNotification('הגיע זמן הצילום השבועי 📸', {
      body: `צילום התקדמות לשבוע ${week} ועדכון משקל ואחוז שומן.`,
      tag: 'weekly-checkin',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      lang: 'he',
      dir: 'rtl',
    });
    await write(db, 'settings', { ...settings, notifiedWeek: week });
  } finally {
    db.close();
  }
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'checkin-reminder') event.waitUntil(checkReminder());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) return c.focus();
    }
    return self.clients.openWindow('./#/today');
  })());
});
