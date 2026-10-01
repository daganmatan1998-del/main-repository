/**
 * Minimal promise wrapper over IndexedDB. Two stores:
 *  - projects: ProjectDoc, keyed by id, unique index on saveCode
 *  - assets:   AssetRecord (source file blobs), keyed by id, index on hash
 */
const DB_NAME = 'model-workspace';
const DB_VERSION = 1;

export const STORE_PROJECTS = 'projects';
export const STORE_ASSETS = 'assets';

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        const s = db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        s.createIndex('saveCode', 'saveCode', { unique: true });
        s.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        const s = db.createObjectStore(STORE_ASSETS, { keyPath: 'id' });
        s.createIndex('hash', 'hash');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('Could not open the project database.'));
    req.onblocked = () => reject(new Error('The project database is open in another tab with an older version.'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDB();
  return wrap(db.transaction(store, 'readonly').objectStore(store).get(key)) as Promise<T | undefined>;
}

export async function dbGetAll<T>(store: string): Promise<T[]> {
  const db = await openDB();
  return wrap(db.transaction(store, 'readonly').objectStore(store).getAll()) as Promise<T[]>;
}

export async function dbGetByIndex<T>(store: string, index: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDB();
  return wrap(db.transaction(store, 'readonly').objectStore(store).index(index).get(key)) as Promise<T | undefined>;
}

export async function dbPut<T>(store: string, value: T): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Write aborted (storage may be full).'));
  });
}

export async function dbDelete(store: string, key: IDBValidKey): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Ask the browser not to evict our data under storage pressure. Best-effort. */
export async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    /* not supported — fine */
  }
}
