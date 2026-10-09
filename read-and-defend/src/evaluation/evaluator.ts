import type { LearningItem } from '../content/types';
import { phonetic } from '../content/hebrew/script';
import {
  EN_FILLERS, englishSoundAlikes, HE_FILLERS, hebrewReadingRegex, normalizeEnglish, normalizeHebrew,
  normalizeLatinPhonetic, shvaVariants,
} from './normalize';

export interface RecognitionAlternative {
  transcript: string;
  /** 0..1 when the provider reports it; undefined when it does not. */
  confidence?: number;
}

export type Outcome = 'correct' | 'incorrect' | 'uncertain';

export interface Evaluation {
  outcome: Outcome;
  /** What we believe was heard (best alternative), for gentle feedback. */
  heard: string;
  /** Why the result is uncertain or incorrect. */
  reason?: 'silence' | 'low-confidence' | 'ambiguous' | 'too-long' | 'mismatch' | 'partial';
  /** For words: index into item.parts of the first part that went wrong. */
  focusPart?: number;
  /** For sentences: which target words were read. */
  wordsRead?: boolean[];
}

/** Below this, a non-matching result is "didn't catch that", not "wrong". */
export const LOW_CONFIDENCE = 0.4;
/** Fraction of a sentence's words that must be read. */
export const SENTENCE_THRESHOLD = 0.8;

/* -------------------------------------------------------------- matchers */

function englishTokenMatches(token: string, target: string): boolean {
  return englishSoundAlikes(target).has(token);
}

function englishSingleMatch(item: LearningItem, transcript: string): boolean {
  const norm = normalizeEnglish(transcript);
  if (!norm) return false;
  const accepted = new Set<string>();
  for (const a of item.accepted) englishSoundAlikes(a).forEach((x) => accepted.add(x));
  if (accepted.has(norm)) return true;
  const tokens = norm.split(' ');
  // Strip filler words; keep the target itself even if it is a filler ("a", "is").
  const content = tokens.filter((t) => !EN_FILLERS.has(t) || accepted.has(t));
  if (content.length === 0) return false;
  if (accepted.has(content.join(' '))) return true;
  // "cat cat" or "c... cat": short utterances containing the answer count.
  return content.length <= 2 && content.some((t) => accepted.has(t));
}

function hebrewWordMatches(target: string, extraSpellings: string[], heardWord: string): boolean {
  const h = normalizeHebrew(heardWord);
  if (!h) return false;
  if (/^[a-z]+$/i.test(h)) {
    const lat = normalizeLatinPhonetic(h);
    return shvaVariants(phonetic(target)).some((p) => p.replace(/ /g, '') === lat);
  }
  const spellings = new Set([normalizeHebrew(target), ...extraSpellings.map(normalizeHebrew)]);
  if (spellings.has(h)) return true;
  const re = hebrewReadingRegex(h);
  return shvaVariants(phonetic(target).replace(/ /g, '')).some((p) => re.test(p));
}

function hebrewSingleMatch(item: LearningItem, transcript: string): boolean {
  // A pointed transcript identical to the target is unambiguous (a few
  // engines return niqqud; the simulator does too).
  const pointed = transcript.normalize('NFC').replace(/[^\u0591-\u05F4 ]/g, '').trim();
  if (/[\u05B0-\u05BC\u05C1\u05C2]/.test(pointed) && pointed === item.display.normalize('NFC').replace(/[^\u0591-\u05F4 ]/g, '').trim()) return true;
  const norm = normalizeHebrew(transcript);
  if (!norm) return false;
  if (item.kind === 'letter') {
    const names = new Set(item.accepted.map(normalizeHebrew));
    if (names.has(norm)) return true;
    const tokens = norm.split(' ').filter((t) => !HE_FILLERS.has(t));
    return names.has(tokens.join(' ')) || (tokens.length <= 2 && tokens.some((t) => names.has(t)));
  }
  // A bare consonant cannot show which vowel was read (see evaluate()).
  if (item.kind === 'syllable' && norm.replace(/ /g, '').length === 1) return false;
  if (hebrewWordMatches(item.display, item.accepted, norm.replace(/ /g, ''))) return true;
  const tokens = norm.split(' ').filter((t) => !HE_FILLERS.has(t));
  return tokens.length <= 2 && tokens.some((t) => hebrewWordMatches(item.display, item.accepted, t));
}

/** Greedy in-order alignment of target words against heard tokens. */
function alignSentence(item: LearningItem, transcript: string): boolean[] {
  const he = item.lang === 'he';
  const heard = (he ? normalizeHebrew(transcript) : normalizeEnglish(transcript)).split(' ').filter(Boolean);
  const targets = item.parts.map((p) => (he ? p : normalizeEnglish(p)));
  const read = targets.map(() => false);
  let j = 0;
  targets.forEach((t, i) => {
    for (let k = j; k < Math.min(heard.length, j + 3); k++) {
      const ok = he ? hebrewWordMatches(t, [], heard[k]) : englishTokenMatches(heard[k], t);
      if (ok) { read[i] = true; j = k + 1; return; }
    }
  });
  return read;
}

/* ------------------------------------------------------- partial feedback */

/** First position at which the heard word departs from the target. */
function firstDifference(item: LearningItem, heard: string): number | undefined {
  if (item.kind !== 'word' || item.lang !== 'en') return undefined;
  const h = normalizeEnglish(heard).split(' ')[0] ?? '';
  const t = item.display.toLowerCase();
  if (!h || Math.abs(h.length - t.length) > 2) return undefined;
  let pos = 0;
  while (pos < t.length && t[pos] === h[pos]) pos++;
  if (pos >= t.length) return undefined;
  // Map letter position to the grapheme (part) that contains it.
  let acc = 0;
  for (let i = 0; i < item.parts.length; i++) {
    const len = item.parts[i].replace('_', '').length;
    if (pos < acc + len) return i;
    acc += len;
  }
  return item.parts.length - 1;
}

/* --------------------------------------------------------------- evaluate */

export function evaluate(item: LearningItem, alternatives: RecognitionAlternative[]): Evaluation {
  const alts = alternatives.filter((a) => a.transcript && a.transcript.trim());
  if (alts.length === 0) return { outcome: 'uncertain', heard: '', reason: 'silence' };
  const best = alts[0];

  if (item.kind === 'sentence') {
    let bestRead: boolean[] = [];
    let bestScore = -1;
    for (const a of alts) {
      const read = alignSentence(item, a.transcript);
      const score = read.filter(Boolean).length / read.length;
      if (score > bestScore) { bestScore = score; bestRead = read; }
    }
    if (bestScore >= SENTENCE_THRESHOLD) return { outcome: 'correct', heard: best.transcript, wordsRead: bestRead };
    if (best.confidence !== undefined && best.confidence > 0 && best.confidence < LOW_CONFIDENCE) {
      return { outcome: 'uncertain', heard: best.transcript, reason: 'low-confidence', wordsRead: bestRead };
    }
    return { outcome: 'incorrect', heard: best.transcript, reason: bestScore > 0 ? 'partial' : 'mismatch', wordsRead: bestRead };
  }

  const match = item.lang === 'he' ? hebrewSingleMatch : englishSingleMatch;
  if (alts.some((a) => match(item, a.transcript))) return { outcome: 'correct', heard: best.transcript };

  // Not a match. Decide whether we actually know the child read it wrong.
  if (best.confidence !== undefined && best.confidence > 0 && best.confidence < LOW_CONFIDENCE) {
    return { outcome: 'uncertain', heard: best.transcript, reason: 'low-confidence' };
  }
  const words = best.transcript.trim().split(/\s+/);
  const targetWords = item.display.trim().split(/\s+/).length;
  if (words.length > Math.max(4, targetWords * 3)) {
    return { outcome: 'uncertain', heard: best.transcript, reason: 'too-long' };
  }
  if (item.lang === 'he' && item.kind === 'syllable') {
    // A bare consonant ("ב") says nothing about which vowel was read.
    const n = normalizeHebrew(best.transcript).replace(/ /g, '');
    if (n.length === 1) return { outcome: 'uncertain', heard: best.transcript, reason: 'ambiguous' };
  }
  return { outcome: 'incorrect', heard: best.transcript, reason: 'mismatch', focusPart: firstDifference(item, best.transcript) };
}
