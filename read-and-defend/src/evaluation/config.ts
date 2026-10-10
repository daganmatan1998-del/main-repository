/**
 * Tunable tolerance for reading evaluation. Nothing in the evaluator hard-codes
 * a threshold: every number that decides "close enough" lives here, so the
 * tolerance can be adjusted (or exposed in settings) without touching the
 * algorithm.
 *
 * Similarity is 0..1 (1 = identical after Hebrew-specific normalisation).
 * An answer is
 *   - accepted           when similarity >= the threshold for its exercise kind,
 *   - "try again"        when it is below the threshold but above `floor`
 *                        (the recogniser may simply have misheard),
 *   - marked incorrect   only below `floor`, or when the engine confidently
 *                        returned something that is a *different* target.
 */

export type HebrewLetterMode = 'strict' | 'normal' | 'lenient';

export interface KindThresholds {
  /** Accept at or above this similarity. 1 = exact phonetic match only. */
  accept: number;
  /** Below accept but at or above this: ask the child to try again. */
  floor: number;
}

export interface HebrewEvalConfig {
  letter: KindThresholds;
  syllable: KindThresholds;
  word: KindThresholds;
  /** Per-word threshold inside a sentence. */
  sentenceWord: number;
  /** Substitution cost between acoustically close consonants (b/p, d/t, m/n…). */
  nearCost: number;
  /** Substitution cost between spellings of one sound (כ/ק, ב/ו). */
  flexCost: number;
  /**
   * Contextual recovery for isolated letters: when the engine returns a short
   * word instead of the letter name ("מה" for מ), accept it if its strong
   * consonants number at most this many and the first one is the target's.
   * 0 disables recovery.
   */
  letterRecoveryMax: number;
  /** An isolated letter is only marked wrong if the engine clearly heard a
   *  different letter, at or above this similarity to that other letter. */
  otherLetterSimilarity: number;
}

/**
 * Guessing from the start of a word. While the child is still speaking the
 * recogniser streams partial text; when that partial text is clearly the
 * beginning of the target word, the reading can be credited without waiting
 * for the engine to finish (fast readers), and when the engine's final text
 * is cut short, the beginning it did catch can still count.
 */
export interface PrefixConfig {
  /** Credit immediately when the heard beginning covers this much of the word. */
  early: number;
  /** When the final transcript is cut short, credit at this coverage. */
  fallback: number;
  /** Minimum consonants that must have been heard before guessing at all. */
  minHeard: number;
  /** Words shorter than this (in consonants) are never guessed. */
  minTarget: number;
  /** How closely the heard beginning must match the target's beginning. */
  similarity: number;
}

export interface EvalConfig {
  /** Confidence below which a non-match is "didn't catch that". */
  lowConfidence: number;
  prefix: PrefixConfig;
  /** Fraction of a sentence's words that must be read. */
  sentenceThreshold: number;
  he: HebrewEvalConfig;
}

export const HEBREW_PRESETS: Record<HebrewLetterMode, HebrewEvalConfig> = {
  /** Exact letter names / spellings only — the behaviour before the fuzzy layer. */
  strict: {
    letter: { accept: 1, floor: 1 }, syllable: { accept: 1, floor: 1 }, word: { accept: 1, floor: 1 },
    sentenceWord: 1, nearCost: 1, flexCost: 1, letterRecoveryMax: 0, otherLetterSimilarity: 0.85,
  },
  /** Default: forgiving for letters and syllables, careful with words. */
  normal: {
    letter: { accept: 0.7, floor: 0.45 }, syllable: { accept: 0.8, floor: 0.6 }, word: { accept: 0.86, floor: 0.78 },
    sentenceWord: 0.82, nearCost: 0.7, flexCost: 0.2, letterRecoveryMax: 1, otherLetterSimilarity: 0.85,
  },
  /** For engines that struggle badly with isolated letters. */
  lenient: {
    letter: { accept: 0.55, floor: 0.3 }, syllable: { accept: 0.72, floor: 0.5 }, word: { accept: 0.82, floor: 0.72 },
    sentenceWord: 0.78, nearCost: 0.5, flexCost: 0.15, letterRecoveryMax: 2, otherLetterSimilarity: 0.85,
  },
};

export function configForMode(mode: HebrewLetterMode): EvalConfig {
  return {
    lowConfidence: 0.4, sentenceThreshold: 0.8, he: HEBREW_PRESETS[mode],
    prefix: mode === 'strict' ? { early: 1.01, fallback: 1.01, minHeard: 99, minTarget: 99, similarity: 1 }
      : mode === 'lenient' ? { early: 0.7, fallback: 0.55, minHeard: 2, minTarget: 3, similarity: 0.8 }
      : { early: 0.75, fallback: 0.6, minHeard: 2, minTarget: 3, similarity: 0.85 },
  };
}

let current: EvalConfig = configForMode('normal');

export const getEvalConfig = (): EvalConfig => current;

/** Replace the active configuration (settings, tests). */
export function setEvalConfig(cfg: EvalConfig | HebrewLetterMode): void {
  current = typeof cfg === 'string' ? configForMode(cfg) : cfg;
}
