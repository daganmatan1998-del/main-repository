/**
 * "A new version is ready - Update".
 *
 * Every build publishes version.json next to the page (vite.config.ts) and
 * carries the same id inside the page. While the game is open it asks for
 * version.json now and then (on start, when the app comes back to the
 * foreground, and every few minutes); when the id differs, an update button
 * appears. Pressing it clears the offline copy and reloads, so the new version
 * runs at once - no reinstalling, progress kept (it lives in localStorage).
 *
 * The Android app built with Capacitor carries its files inside the APK, so
 * there is nothing to fetch there; it is updated by installing a new APK.
 */
declare const __APP_VERSION__: string;
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

const CHECK_EVERY_MS = 5 * 60 * 1000;
let latest: string | null = null;
const listeners = new Set<(version: string) => void>();

function isNativeShell(): boolean {
  return !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
}

export async function checkForUpdate(): Promise<boolean> {
  try {
    // A unique URL and no-store: neither the browser nor an older offline
    // copy of the game may answer this from a cache.
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const { version } = (await res.json()) as { version?: string };
    if (typeof version === 'string' && version && version !== APP_VERSION && version !== latest) {
      latest = version;
      listeners.forEach((fn) => fn(version));
    }
  } catch { /* offline: try again later */ }
  return latest !== null;
}

export function updateAvailable(): boolean {
  return latest !== null;
}

export function onUpdateAvailable(fn: (version: string) => void): void {
  listeners.add(fn);
  if (latest) fn(latest);
}

export function startUpdateChecks(): void {
  if (isNativeShell() || location.protocol === 'file:' || import.meta.env.DEV) return;
  void checkForUpdate();
  setInterval(() => { void checkForUpdate(); }, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void checkForUpdate(); });
}

/** Drop the offline copy and load the new version. Progress is not touched. */
export async function applyUpdate(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch { /* no service worker */ }
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch { /* no Cache API */ }
  location.reload();
}
