/**
 * Platform adapter: the only place that knows whether we run in a browser or
 * inside the Capacitor shell. Game code calls these helpers and never checks
 * the platform itself.
 */
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, unknown>;
}

const cap = (): CapacitorGlobal | undefined => (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;

export const isNative = (): boolean => !!cap()?.isNativePlatform?.();
export const platformName = (): string => cap()?.getPlatform?.() ?? 'web';

export function haptic(kind: 'light' | 'success' | 'soft' = 'light'): void {
  const h = cap()?.Plugins?.Haptics as { impact?: (o: { style: string }) => Promise<void> } | undefined;
  if (h?.impact) { h.impact({ style: kind === 'success' ? 'MEDIUM' : 'LIGHT' }).catch(() => undefined); return; }
  try { navigator.vibrate?.(kind === 'success' ? [20, 40, 20] : 12); } catch { /* unsupported */ }
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Register the offline service worker on the web (not inside the native shell). */
export function registerServiceWorker(): void {
  if (isNative() || !('serviceWorker' in navigator) || location.protocol === 'file:') return;
  if (import.meta.env.DEV) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}

/** Keep the screen awake during play where supported (no-op elsewhere). */
let wakeLock: { release: () => Promise<void> } | null = null;
export async function keepAwake(on: boolean): Promise<void> {
  try {
    const nav = navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } };
    if (on && nav.wakeLock && !wakeLock) wakeLock = await nav.wakeLock.request('screen');
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* not allowed: fine */ }
}
