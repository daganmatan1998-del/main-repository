// Thin promise wrapper around IndexedDB.
//
// Why IndexedDB: the app is local-first. Body metrics and progress photos are
// sensitive, so they never leave the device; IndexedDB stores Blobs natively
// (no base64 bloat), survives restarts, is private to this origin, and works
// offline. Capacitor's WebView keeps the same IndexedDB, so a native wrap
// needs no storage migration.

const DB_NAME = 'nutri';
const DB_VERSION = 1;

let dbp;

export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('checkins')) db.createObjectStore('checkins', { keyPath: 'week' });
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('metrics')) db.createObjectStore('metrics', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab deleting the database must not hang on us.
      db.onversionchange = () => { db.close(); dbp = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  return dbp;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
  });
}

export const kv = {
  get: (key) => tx('kv', 'readonly', (s) => wrap(s.get(key))),
  set: (key, value) => tx('kv', 'readwrite', (s) => wrap(s.put(value, key))),
  del: (key) => tx('kv', 'readwrite', (s) => wrap(s.delete(key))),
};

export const getAll = (store) => tx(store, 'readonly', (s) => wrap(s.getAll()));
export const get = (store, key) => tx(store, 'readonly', (s) => wrap(s.get(key)));
export const put = (store, value) => tx(store, 'readwrite', (s) => wrap(s.put(value)));
export const del = (store, key) => tx(store, 'readwrite', (s) => wrap(s.delete(key)));

// Writes a photo and its check-in record atomically, so a crash between the two
// can never leave a check-in pointing at a missing photo.
export async function putPhotoAndCheckin(photo, checkin) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(['photos', 'checkins'], 'readwrite');
    t.objectStore('photos').put(photo);
    t.objectStore('checkins').put(checkin);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
  });
}

export async function deleteEverything() {
  if (dbp) {
    try { (await dbp).close(); } catch { /* already closed */ }
    dbp = null;
  }
  // "blocked" only means another connection (another tab, the service worker)
  // is still open; they close on versionchange, so keep waiting for success.
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    const timer = setTimeout(() => reject(new Error('delete blocked')), 10000);
    req.onsuccess = () => { clearTimeout(timer); resolve(); };
    req.onerror = () => { clearTimeout(timer); reject(req.error); };
  });
}
