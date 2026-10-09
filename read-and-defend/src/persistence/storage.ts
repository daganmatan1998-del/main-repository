/**
 * Storage adapter. The first version keeps everything on the device
 * (localStorage). A cloud-sync adapter implements the same interface; the
 * game never touches localStorage directly. On Capacitor, swap in an adapter
 * backed by @capacitor/preferences, which survives WebView cache clears.
 */
export interface StorageAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  readonly persistent: boolean;
}

export class LocalStorageAdapter implements StorageAdapter {
  readonly persistent = true;
  get(key: string) { return window.localStorage.getItem(key); }
  set(key: string, value: string) { window.localStorage.setItem(key, value); }
  remove(key: string) { window.localStorage.removeItem(key); }
}

export class MemoryStorageAdapter implements StorageAdapter {
  readonly persistent = false;
  private m = new Map<string, string>();
  get(key: string) { return this.m.get(key) ?? null; }
  set(key: string, value: string) { this.m.set(key, value); }
  remove(key: string) { this.m.delete(key); }
}

/** localStorage when it works (it throws on file:// and in some private modes). */
export function createStorage(): StorageAdapter {
  try {
    const k = '__rd_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return new LocalStorageAdapter();
  } catch {
    return new MemoryStorageAdapter();
  }
}
