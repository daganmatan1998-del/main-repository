// Keeps this device and the user's cloud copy in step (see cloud.js).
//
// The whole user state (store.snapshot) is one document; the newest copy wins
// (savedAt). That is right for one person moving between their own devices.
// Two devices edited offline at the same time keep the later of the two.
//
// The first time a device that already has data signs in to an account that
// already has data too, nothing is overwritten silently: the user picks which
// copy to keep (resolveConflict).
//
// Files travel separately: the profile picture always, progress photos only
// when the user turned on photo backup (settings.photoBackup). Turning it off
// deletes the cloud copies of the photos.

import * as cloud from './cloud.js';
import * as store from './store.js';
import { state } from './store.js';

const status = { busy: false, error: '', conflict: false };
let pendingRemote = null;
let running = null;
let timer = null;

export const syncStatus = () => ({ ...status, syncedAt: state.meta.syncedAt || 0 });

function setStatus(patch) {
  Object.assign(status, patch);
  window.dispatchEvent(new Event('app:sync'));
}

const linkedHere = () => cloud.signedIn() && state.meta.syncedUser === cloud.currentUser().id;

// Startup: restore the session, finish a sign-in that just came back from
// Google, and start listening for changes.
export async function startSync() {
  if (!cloud.cloudReady()) return null;
  await cloud.loadSession();
  const back = await cloud.finishSignIn();
  store.onSaved(schedulePush);
  window.addEventListener('online', () => { if (status.error === 'offline') syncNow(); });
  let lastVisible = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastVisible > 60000) syncNow();
    if (document.visibilityState === 'visible') lastVisible = Date.now();
  });
  return back;
}

export function syncNow() {
  if (!cloud.cloudReady() || !cloud.signedIn()) return Promise.resolve({});
  if (!running) running = run().finally(() => { running = null; });
  return running;
}

async function run() {
  setStatus({ busy: true, error: '' });
  try {
    const user = cloud.currentUser();
    const remote = await cloud.pullState();
    const hasLocal = store.isOnboarded();
    const result = {};
    if (!remote) {
      if (hasLocal) await cloud.pushState(store.snapshot());
    } else if (hasLocal && state.meta.syncedUser !== user.id && remote.savedAt !== state.meta.savedAt) {
      // Both sides have data and they were never synced with each other.
      pendingRemote = remote;
      setStatus({ conflict: true });
      return { conflict: true };
    } else if (!hasLocal || remote.savedAt > (state.meta.savedAt || 0)) {
      await store.applySnapshot(remote);
      await pullAvatar(remote);
      result.restored = true;
    } else if (remote.savedAt < state.meta.savedAt) {
      await cloud.pushState(store.snapshot());
    }
    await store.saveMeta({ syncedUser: user.id });
    await syncFiles();
    await store.saveMeta({ syncedAt: Date.now() });
    return result;
  } catch (e) {
    setStatus({ error: e.code || 'failed' });
    return { error: e.code || 'failed' };
  } finally {
    setStatus({ busy: false });
  }
}

// choice: 'cloud' (replace this device's data) or 'device' (replace the cloud's).
export async function resolveConflict(choice) {
  const remote = pendingRemote;
  pendingRemote = null;
  setStatus({ conflict: false });
  if (choice === 'cloud' && remote) {
    await store.applySnapshot(remote);
    await pullAvatar(remote);
    await store.saveMeta({ syncedUser: cloud.currentUser().id });
  } else {
    await store.saveMeta({ syncedUser: cloud.currentUser().id, avatarUp: 0, uploaded: [] });
    await cloud.pushState(store.snapshot());
  }
  return syncNow();
}

// A local change: upload it shortly (changes in quick succession go up once).
function schedulePush() {
  // Never upload an empty state over the account (e.g. mid-registration).
  if (!linkedHere() || !store.isOnboarded()) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (running) await running.catch(() => {});
    try {
      await cloud.pushState(store.snapshot());
      await syncFiles();
      await store.saveMeta({ syncedAt: Date.now() });
      if (status.error) setStatus({ error: '' });
    } catch (e) {
      setStatus({ error: e.code || 'failed' });
    }
  }, 1500);
}

// ---------- files ----------

const AVATAR = 'profile/avatar.jpg';
const photoFile = (id) => `photos/${id}.jpg`;

async function pullAvatar(remote) {
  const at = remote.avatarAt || 0;
  const local = state.avatar ? state.avatar.at : 0;
  if (at === local) return;
  const blob = at ? await cloud.getFile(AVATAR) : null;
  await store.restoreAvatar(blob, blob ? at : 0);
  await store.saveMeta({ avatarUp: blob ? at : 0 });
}

async function syncFiles() {
  // Profile picture.
  const at = state.avatar ? state.avatar.at : 0;
  if (at && at !== state.meta.avatarUp) {
    await cloud.putFile(AVATAR, state.avatar.blob);
    await store.saveMeta({ avatarUp: at });
  } else if (!at && state.meta.avatarUp) {
    await cloud.removeFiles([AVATAR]);
    await store.saveMeta({ avatarUp: 0 });
  }

  // Progress photos.
  const uploaded = new Set(state.meta.uploaded || []);
  if (!state.settings.photoBackup) {
    if (uploaded.size) {
      await cloud.removeFiles(await cloud.listFiles('photos'));
      await store.saveMeta({ uploaded: [] });
    }
    return;
  }
  let changed = false;
  const wanted = new Set(state.checkins.map((c) => c.photoId).filter(Boolean));
  for (const c of state.checkins) {
    if (!c.photoId) continue;
    const local = await store.getPhoto(c.photoId);
    if (local && !uploaded.has(c.photoId)) {
      await cloud.putFile(photoFile(c.photoId), local.blob);
      uploaded.add(c.photoId);
      await store.saveMeta({ uploaded: [...uploaded] });
    } else if (!local) {
      const blob = await cloud.getFile(photoFile(c.photoId));
      if (blob) {
        const { width, height } = await dims(blob);
        await store.putPhoto({ id: c.photoId, week: c.week, blob, width, height, type: blob.type || 'image/jpeg', createdAt: c.photoAt || Date.now() });
        uploaded.add(c.photoId);
        await store.saveMeta({ uploaded: [...uploaded] });
        changed = true;
      }
    }
  }
  // A replaced week's old photo has no check-in pointing at it any more.
  const stale = [...uploaded].filter((id) => !wanted.has(id));
  if (stale.length) {
    await cloud.removeFiles(stale.map(photoFile));
    await store.saveMeta({ uploaded: [...uploaded].filter((id) => wanted.has(id)) });
  }
  if (changed) window.dispatchEvent(new Event('app:rerender'));
}

async function dims(blob) {
  try {
    const b = await createImageBitmap(blob);
    const d = { width: b.width, height: b.height };
    if (b.close) b.close();
    return d;
  } catch {
    return { width: 0, height: 0 };
  }
}
