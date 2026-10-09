import {
  nextSessionId, SpeechError, type Availability, type ListenOptions, type ListenSession,
  type RecognitionResult, type SpeechProvider,
} from './types';

/**
 * Native recognition inside the Capacitor app, via the community plugin
 * `@capacitor-community/speech-recognition` (Android SpeechRecognizer, iOS
 * SFSpeechRecognizer). Android and iOS WebViews have no Web Speech API, so
 * this adapter is what makes voice work in the store builds.
 *
 * It is resolved at runtime from window.Capacitor.Plugins, so the web build
 * carries no dependency on it.
 */
interface NativePlugin {
  available(): Promise<{ available: boolean }>;
  requestPermissions(): Promise<{ speechRecognition: string }>;
  start(o: { language: string; maxResults: number; partialResults: boolean; popup: boolean }): Promise<{ matches?: string[] }>;
  stop(): Promise<void>;
}

export function getNativePlugin(): NativePlugin | null {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  return (cap.Plugins?.SpeechRecognition as NativePlugin | undefined) ?? null;
}

export class NativeProvider implements SpeechProvider {
  readonly id = 'native' as const;
  readonly simulated = false;

  async checkAvailability(): Promise<Availability> {
    const p = getNativePlugin();
    if (!p) return { ok: false, reason: 'not-supported' };
    try {
      const { available } = await p.available();
      return available ? { ok: true } : { ok: false, reason: 'not-supported' };
    } catch {
      return { ok: false, reason: 'not-supported' };
    }
  }

  async requestPermission(): Promise<Availability> {
    const p = getNativePlugin();
    if (!p) return { ok: false, reason: 'not-supported' };
    const r = await p.requestPermissions();
    return r.speechRecognition === 'granted' ? { ok: true } : { ok: false, reason: 'permission-denied' };
  }

  start(opts: ListenOptions): ListenSession {
    const p = getNativePlugin();
    const id = nextSessionId();
    let aborted = false;
    const result: Promise<RecognitionResult> = p
      ? p.start({ language: opts.lang, maxResults: 5, partialResults: false, popup: false })
          .then((r) => ({ alternatives: aborted ? [] : (r.matches ?? []).map((t) => ({ transcript: t })), provider: this.id }))
          .catch((e) => {
            const msg = String(e?.message ?? e).toLowerCase();
            if (msg.includes('no match') || msg.includes('no speech')) return { alternatives: [], provider: this.id };
            if (msg.includes('permission')) throw new SpeechError('permission-denied');
            throw new SpeechError('unknown', msg);
          })
      : Promise.reject(new SpeechError('not-supported'));
    return {
      id, result,
      stop: () => { p?.stop().catch(() => undefined); },
      abort: () => { aborted = true; p?.stop().catch(() => undefined); },
    };
  }
}
