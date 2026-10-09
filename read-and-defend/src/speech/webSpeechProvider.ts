import { requestMicrophone } from './micPermission';
import {
  nextSessionId, SpeechError, type Availability, type ListenOptions, type ListenSession,
  type RecognitionResult, type SpeechProvider,
} from './types';

/* Minimal typings: the Web Speech API is not in lib.dom for every TS version. */
interface SRAlternative { transcript: string; confidence: number }
interface SRResult { isFinal: boolean; length: number; [i: number]: SRAlternative }
interface SREvent { resultIndex: number; results: { length: number; [i: number]: SRResult } }
interface SRErrorEvent { error: string; message?: string }
interface SR {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null; onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null; onstart: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type SRCtor = new () => SR;

export function getSpeechRecognitionCtor(): SRCtor | null {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function mapError(code: string): SpeechError | null {
  switch (code) {
    case 'not-allowed': case 'service-not-allowed': return new SpeechError('permission-denied');
    case 'audio-capture': return new SpeechError('no-microphone');
    case 'network': return new SpeechError('network');
    case 'language-not-supported': return new SpeechError('language-unsupported');
    case 'no-speech': case 'aborted': return null; // not failures: just nothing heard
    default: return new SpeechError('unknown', code);
  }
}

/**
 * Browser speech recognition (Chrome/Edge desktop & Android, Safari 14.5+).
 * Chrome sends audio to Google's servers for recognition; Safari uses Apple's
 * (on-device for some languages). Neither stores audio in this app.
 * Not available in Firefox, or in Android/iOS WebViews — use the native or
 * server provider there.
 */
export class WebSpeechProvider implements SpeechProvider {
  readonly id = 'webspeech' as const;
  readonly simulated = false;

  async checkAvailability(): Promise<Availability> {
    if (!getSpeechRecognitionCtor()) return { ok: false, reason: 'not-supported' };
    if (window.isSecureContext === false) return { ok: false, reason: 'insecure-context' };
    return { ok: true };
  }

  requestPermission(): Promise<Availability> {
    return requestMicrophone();
  }

  start(opts: ListenOptions): ListenSession {
    const Ctor = getSpeechRecognitionCtor();
    const id = nextSessionId();
    if (!Ctor) {
      return { id, result: Promise.reject(new SpeechError('not-supported')), stop() {}, abort() {} };
    }
    const rec = new Ctor();
    rec.lang = opts.lang;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 5;

    let settled = false;
    let finalAlts: RecognitionResult['alternatives'] = [];
    let lastInterim = '';
    let timer: ReturnType<typeof setTimeout> | undefined;

    const result = new Promise<RecognitionResult>((resolve, reject) => {
      const finish = (err?: SpeechError | null) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (err) { reject(err); return; }
        // If we were stopped before a final result, the last interim text is
        // still the best evidence we have — but mark it as low confidence.
        const alts = finalAlts.length ? finalAlts : lastInterim ? [{ transcript: lastInterim, confidence: 0.3 }] : [];
        resolve({ alternatives: alts, provider: this.id });
      };
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) {
            const alts = [];
            for (let j = 0; j < r.length; j++) {
              // Chrome reports 0 for "unknown"; treat it as unknown, not as 0%.
              alts.push({ transcript: r[j].transcript, confidence: r[j].confidence > 0 ? r[j].confidence : undefined });
            }
            finalAlts = alts;
          } else {
            lastInterim = r[0]?.transcript ?? '';
            opts.onInterim?.(lastInterim);
          }
        }
      };
      rec.onerror = (e) => finish(mapError(e.error));
      rec.onend = () => finish();
      try {
        rec.start();
      } catch (e) {
        finish(new SpeechError('unknown', String(e)));
      }
      timer = setTimeout(() => { try { rec.stop(); } catch { /* ended */ } }, opts.maxDurationMs ?? 9000);
    });

    return {
      id,
      result,
      stop: () => { try { rec.stop(); } catch { /* already ended */ } },
      abort: () => { finalAlts = []; lastInterim = ''; try { rec.abort(); } catch { /* ended */ } },
    };
  }
}
