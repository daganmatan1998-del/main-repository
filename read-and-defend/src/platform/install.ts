/**
 * "Install the app" (add to home screen) for the web version.
 *
 * Chrome, Edge and Samsung Internet on Android and desktop fire
 * `beforeinstallprompt`; keeping that event lets one button do the whole
 * installation. Safari on iPhone/iPad has no such API - Apple only allows
 * Share → Add to Home Screen - so there the button explains the two taps.
 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;

export function initInstall(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep it for our own button
    deferred = e as InstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => { deferred = null; installed = true; });
}

/** Already running as an installed app (or inside the store build). */
export function isInstalled(): boolean {
  if (installed) return true;
  const nav = navigator as Navigator & { standalone?: boolean };
  const mq = (q: string) => window.matchMedia?.(q).matches ?? false;
  const native = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
  return native || nav.standalone === true || mq('(display-mode: standalone)') || mq('(display-mode: fullscreen)') || mq('(display-mode: minimal-ui)');
}

export function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as a Mac with a touch screen.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** 'prompt': one tap installs. 'ios' / 'manual': show the steps. */
export function installMode(): 'prompt' | 'ios' | 'manual' {
  if (deferred) return 'prompt';
  return isIos() ? 'ios' : 'manual';
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = deferred;
  if (!e) return 'unavailable';
  deferred = null; // a prompt can be used once
  try {
    await e.prompt();
    const choice = await e.userChoice;
    if (choice.outcome === 'accepted') installed = true;
    return choice.outcome;
  } catch {
    return 'unavailable';
  }
}
