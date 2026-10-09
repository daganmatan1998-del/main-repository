import { Emitter } from '../core/emitter';
import { nextSessionId, type Availability, type ListenOptions, type ListenSession, type RecognitionResult, type SpeechProvider } from './types';

export type SimulatedAnswer = 'correct' | 'wrong' | 'unclear' | 'silence';

/** The dev panel publishes button presses here. */
export const simulatorBus = new Emitter<{ answer: SimulatedAnswer }>();

/**
 * DEVELOPMENT ONLY. Pretends to recognise speech so the game can be played
 * and tested without a microphone. It is never chosen automatically: it is
 * used only when Development mode is switched on in the grown-ups' settings,
 * and every screen that uses it shows a "Simulated — not real voice
 * recognition" banner. Results still go through the real evaluator.
 */
export class SimulatedProvider implements SpeechProvider {
  readonly id = 'simulated' as const;
  readonly simulated = true;

  async checkAvailability(): Promise<Availability> { return { ok: true }; }
  async requestPermission(): Promise<Availability> { return { ok: true }; }

  start(opts: ListenOptions): ListenSession {
    const id = nextSessionId();
    let off: () => void = () => undefined;
    let resolveFn: (r: RecognitionResult) => void = () => undefined;
    const result = new Promise<RecognitionResult>((resolve) => {
      resolveFn = resolve;
      off = simulatorBus.on('answer', (a) => {
        off();
        const t = opts.simulateTarget ?? '';
        const alts =
          a === 'correct' ? [{ transcript: t, confidence: 0.92 }]
          : a === 'wrong' ? [{ transcript: opts.lang.startsWith('he') ? 'מכונית' : 'banana', confidence: 0.9 }]
          // Unintelligible, whatever the target: a letter-sized prefix of the target would be a valid reading.
          : a === 'unclear' ? [{ transcript: '…', confidence: 0.2 }]
          : [];
        resolve({ alternatives: alts, provider: this.id });
      });
    });
    return {
      id, result,
      stop: () => undefined,
      abort: () => { off(); resolveFn({ alternatives: [], provider: this.id }); },
    };
  }
}
