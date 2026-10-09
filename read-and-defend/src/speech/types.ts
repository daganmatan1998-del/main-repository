import type { RecognitionAlternative } from '../evaluation/evaluator';

/**
 * Speech recognition contract. The game depends only on this interface; the
 * browser's Web Speech API, a server-side transcription service, a native
 * mobile plugin and the development simulator are interchangeable adapters.
 */

export type SpeechErrorCode =
  | 'not-supported'        // this browser/WebView has no recogniser
  | 'permission-denied'    // the user (or OS) blocked the microphone
  | 'no-microphone'        // no input device / capture failed
  | 'insecure-context'     // microphone requires HTTPS (or localhost)
  | 'network'              // recogniser needs the network and could not reach it
  | 'service-unavailable'  // server proxy reachable but failing
  | 'not-configured'       // server proxy missing or without credentials
  | 'language-unsupported' // recogniser does not do this language
  | 'aborted'
  | 'unknown';

export class SpeechError extends Error {
  constructor(public code: SpeechErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'SpeechError';
  }
}

export interface RecognitionResult {
  /** Best first. Empty means nothing intelligible was heard. */
  alternatives: RecognitionAlternative[];
  provider: string;
}

export interface ListenOptions {
  /** BCP-47, e.g. "he-IL", "en-US". */
  lang: string;
  /** Hard stop so a stuck session never blocks the game. */
  maxDurationMs?: number;
  /** Live partial transcript, where the provider supports it. */
  onInterim?: (text: string) => void;
  /** Input level 0..1, where the provider can measure it. */
  onLevel?: (level: number) => void;
  /**
   * Development simulator only: the text a "correct" simulated reading
   * returns. Real providers ignore it — they never see the target.
   */
  simulateTarget?: string;
}

export interface ListenSession {
  readonly id: number;
  /** Resolves once with the final result; rejects with SpeechError. */
  readonly result: Promise<RecognitionResult>;
  /** Finish listening and deliver what was heard. */
  stop(): void;
  /** Cancel; the result resolves with no alternatives. */
  abort(): void;
}

export interface Availability {
  ok: boolean;
  reason?: SpeechErrorCode;
  detail?: string;
}

/** Always-on listening: the microphone stays open for the whole level. */
export interface ContinuousOptions {
  lang: string;
  /**
   * Every recognition result, partial (still speaking) or final. One
   * utterance keeps the same id from its first partial to its final result.
   */
  onResult: (alternatives: RecognitionResult['alternatives'], final: boolean, utteranceId: string) => void;
  /** Fatal errors stop listening; others are reported and listening resumes. */
  onError: (err: SpeechError, fatal: boolean) => void;
  onLevel?: (level: number) => void;
  /** Development simulator only: the current target, for "correct" answers. */
  simulateTarget?: () => string;
}

export interface ContinuousSession {
  stop(): void;
}

export const FATAL_SPEECH_ERRORS: ReadonlySet<SpeechErrorCode> = new Set<SpeechErrorCode>([
  'permission-denied', 'not-supported', 'insecure-context', 'no-microphone', 'language-unsupported', 'not-configured',
]);

export interface SpeechProvider {
  readonly id: 'webspeech' | 'server' | 'native' | 'simulated';
  /** True only for the development simulator. Shown in the UI, always. */
  readonly simulated: boolean;
  checkAvailability(lang: string): Promise<Availability>;
  /** Ask for the microphone. Resolves to an availability verdict. */
  requestPermission(): Promise<Availability>;
  start(opts: ListenOptions): ListenSession;
  /** Native always-on mode, where the engine supports it (see speech/continuous.ts). */
  listen?(opts: ContinuousOptions): ContinuousSession;
}

let sessionCounter = 0;
export const nextSessionId = () => ++sessionCounter;
