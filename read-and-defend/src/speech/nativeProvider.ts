import {
  FATAL_SPEECH_ERRORS, nextSessionId, SpeechError, type Availability, type ContinuousOptions, type ContinuousSession,
  type ListenOptions, type ListenSession, type RecognitionResult, type SpeechProvider,
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
interface ListenerHandle { remove(): Promise<void> | void }
export interface NativePlugin {
  available(): Promise<{ available: boolean }>;
  requestPermissions(): Promise<{ speechRecognition: string }>;
  start(o: { language: string; maxResults: number; partialResults: boolean; popup: boolean }): Promise<{ matches?: string[] }>;
  stop(): Promise<void>;
  isListening?(): Promise<{ listening: boolean }>;
  addListener?(event: 'partialResults', fn: (d: { matches?: string[] }) => void): Promise<ListenerHandle> | ListenerHandle;
}

/** How long one listening turn may last before it is restarted. */
const NATIVE_TURN_MS = 12000;
/** After the recogniser stops, its last words can still arrive this late. */
const NATIVE_SETTLE_MS = 450;
const POLL_MS = 200;

export function getNativePlugin(): NativePlugin | null {
  const w = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> };
    /** Set by the native build: window.__nativeSpeech = SpeechRecognition (see README). */
    __nativeSpeech?: NativePlugin;
  };
  if (!w.Capacitor?.isNativePlatform?.()) return null;
  return w.__nativeSpeech ?? (w.Capacitor.Plugins?.SpeechRecognition as NativePlugin | undefined) ?? null;
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

  /**
   * Live listening in the app: every word is delivered while it is being
   * said (Android's partial results), not after the child stops talking.
   * Android's recogniser hears one utterance at a time, so each turn ends on
   * a pause, its last words are delivered as final, and the next turn starts
   * at once. Without live support (an older plugin) it falls back to the
   * utterance-by-utterance loop in continuous.ts.
   */
  get listen(): ((opts: ContinuousOptions) => ContinuousSession) | undefined {
    const p = getNativePlugin();
    if (!p?.addListener || !p.isListening) return undefined;
    return (opts) => listenLive(p, opts);
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

export function listenLive(p: NativePlugin, opts: ContinuousOptions): ContinuousSession {
  let stopped = false;
  let turn = 0;
  let last: string[] = [];
  let failures = 0;
  let handle: ListenerHandle | null = null;
  const alts = (m: string[]) => m.filter((t) => t && t.trim()).slice(0, 5).map((t) => ({ transcript: t }));
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const run = async () => {
    handle = await p.addListener!('partialResults', (d) => {
      if (stopped) return;
      const m = d.matches ?? [];
      if (!m.length) return;
      last = m;
      opts.onResult(alts(m), false, `native:${turn}`);
    });
    while (!stopped) {
      turn += 1;
      last = [];
      const startedAt = Date.now();
      try {
        await p.start({ language: opts.lang, maxResults: 5, partialResults: true, popup: false });
        failures = 0;
      } catch (e) {
        const msg = String((e as { message?: string })?.message ?? e).toLowerCase();
        const err = msg.includes('permission') ? new SpeechError('permission-denied') : new SpeechError('unknown', msg);
        const fatal = FATAL_SPEECH_ERRORS.has(err.code);
        opts.onError(err, fatal);
        if (fatal) { stopped = true; break; }
        failures += 1;
        await wait(Math.min(8000, 800 * failures));
        continue;
      }
      // Wait for the turn to end: a pause, an error ("no match"), or the time limit.
      while (!stopped) {
        await wait(POLL_MS);
        let listening = false;
        try { listening = (await p.isListening!()).listening; } catch { listening = false; }
        if (!listening) break;
        if (Date.now() - startedAt > NATIVE_TURN_MS) { await p.stop().catch(() => undefined); break; }
      }
      if (stopped) break;
      await wait(NATIVE_SETTLE_MS); // the final words arrive just after the pause
      if (!stopped && last.length) opts.onResult(alts(last), true, `native:${turn}`);
    }
  };
  run().catch((e) => opts.onError(new SpeechError('unknown', String(e)), false));

  return {
    stop: () => {
      stopped = true;
      p.stop().catch(() => undefined);
      void handle?.remove();
    },
  };
}
