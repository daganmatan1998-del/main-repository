import { SpeechError, type Availability } from './types';

/** Map a getUserMedia failure to our error codes. */
export function mapMediaError(e: unknown): SpeechError {
  const name = (e as { name?: string })?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return new SpeechError('permission-denied');
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError') return new SpeechError('no-microphone');
  return new SpeechError('unknown', String((e as Error)?.message ?? e));
}

/**
 * Ask for the microphone once, then release it immediately. We never keep
 * or record audio here; this only triggers the permission prompt at a moment
 * the child (and grown-up) has been told about.
 */
export async function requestMicrophone(): Promise<Availability> {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return { ok: false, reason: 'insecure-context' };
  }
  if (!navigator.mediaDevices?.getUserMedia) return { ok: false, reason: 'not-supported' };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return { ok: true };
  } catch (e) {
    const err = mapMediaError(e);
    return { ok: false, reason: err.code, detail: err.message };
  }
}

/** Current permission state without prompting, where the browser exposes it. */
export async function queryMicPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
    return (status?.state as 'granted' | 'denied' | 'prompt') ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
