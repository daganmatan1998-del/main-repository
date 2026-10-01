/** Unambiguous alphabet: no 0/O, 1/I/L. */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function randomChars(n: number, alphabet: string): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < n; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function uid(prefix = ''): string {
  const id = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${randomChars(12, 'abcdefghijklmnopqrstuvwxyz0123456789')}`;
  return prefix ? `${prefix}_${id}` : id;
}

/** e.g. "3D-7K29-XP4M". Uniqueness is enforced by the caller against storage. */
export function generateSaveCode(): string {
  return `3D-${randomChars(4, CODE_ALPHABET)}-${randomChars(4, CODE_ALPHABET)}`;
}

/** Accepts sloppy input ("3d 7k29xp4m", "7K29-XP4M") and returns the canonical form, or null. */
export function normalizeSaveCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^0-9A-Z]/g, '');
  const body = raw.startsWith('3D') && raw.length === 10 ? raw.slice(2) : raw;
  if (body.length !== 8) return null;
  return `3D-${body.slice(0, 4)}-${body.slice(4)}`;
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
