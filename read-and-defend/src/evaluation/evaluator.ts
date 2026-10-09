import type { LearningItem } from '../content/types';
import { phonetic } from '../content/hebrew/script';
import { getPack } from '../content/registry';
import { getEvalConfig, type EvalConfig, type HebrewEvalConfig } from './config';
import {
  bestSimilarity, latinToSyms, letterCandidates, similarity, strong, syllableVowel, toSyms, vowelEvidence, type Sym,
} from './hebrewPhonetic';
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

/** Defaults, kept for callers that import them; the live values come from config.ts. */
export const LOW_CONFIDENCE = 0.4;
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
function alignSentence(item: LearningItem, transcript: string, cfg: EvalConfig): boolean[] {
  const he = item.lang === 'he';
  const heard = (he ? normalizeHebrew(transcript) : normalizeEnglish(transcript)).split(' ').filter(Boolean);
  const targets = item.parts.map((p) => (he ? p : normalizeEnglish(p)));
  const read = targets.map(() => false);
  let j = 0;
  targets.forEach((t, i) => {
    for (let k = j; k < Math.min(heard.length, j + 3); k++) {
      const ok = he
        ? hebrewWordMatches(t, [], heard[k]) || heWordSimilarity([t], heard[k], cfg.he) >= cfg.he.sentenceWord
        : englishTokenMatches(heard[k], t);
      if (ok) { read[i] = true; j = k + 1; return; }
    }
  });
  return read;
}

/* ---------------------------------------------- Hebrew phonetic layer */

/**
 * Similarity of a recogniser's word to the target, by sound. Latin
 * transliterations are compared on consonants only (they carry no vowel
 * letters); Hebrew spellings on weighted sound classes (see hebrewPhonetic).
 */
function heWordSimilarity(targetSpellings: string[], heardWord: string, th: HebrewEvalConfig): number {
  const h = normalizeHebrew(heardWord).replace(/ /g, '');
  if (!h) return 0;
  let best = 0;
  if (/^[a-z]+$/i.test(h)) {
    const hs = latinToSyms(h);
    for (const sp of targetSpellings) best = Math.max(best, similarity(hs, strong(toSyms(sp)), th));
    return best;
  }
  const hs = toSyms(h);
  for (const sp of targetSpellings) best = Math.max(best, similarity(hs, toSyms(sp), th));
  return best;
}

/** What the recogniser said, as candidate strings: whole utterance and each short token. */
function heardStrings(transcript: string): string[] {
  const norm = normalizeHebrew(transcript);
  const all = norm.split(' ').filter(Boolean);
  // Hesitations ("אמ") are dropped only when something else was said: on its
  // own, "אמ" is also the letter מ (and "אם", the word "if", normalises to it).
  const content = all.filter((t) => !HE_FILLERS.has(t));
  const tokens = content.length ? content : all.filter((t) => t !== 'אות' && t !== 'סופית');
  if (!tokens.length) return [];
  const out = new Set<string>([tokens.join('')]);
  if (tokens.length <= 3) tokens.forEach((t) => out.add(t));
  return [...out];
}

interface HebrewVerdict { outcome: Outcome; reason?: Evaluation['reason'] }

const otherLetterCache = new Map<string, Sym[][]>();
function candidatesOf(l: LearningItem): Sym[][] {
  let c = otherLetterCache.get(l.id);
  if (!c) { c = letterCandidates(l.display, l.accepted); otherLetterCache.set(l.id, c); }
  return c;
}

/** Does the heard text start a letter name, covering at least 60 % of its consonants (and two or more)? */
function nameStartOf(heard: Sym[], cands: Sym[][], th: HebrewEvalConfig): boolean {
  const hs = strong(heard);
  if (hs.length < 2) return false;
  return cands.some((c) => {
    const cs = strong(c);
    return cs.length >= 3 && hs.length < cs.length && hs.length / cs.length >= 0.6
      && similarity(hs, cs.slice(0, hs.length), th) >= 0.99;
  });
}

/** First pronounced consonant class of a target letter, if it has one. */
function firstStrong(cands: Sym[][]): string | null {
  for (const c of cands) { const s = strong(c); if (s.length) return s[0].c; }
  return null;
}

/**
 * Isolated letters. Recognisers are poor at these — they return the name in
 * odd spellings, a short word that starts with the sound, or a different
 * letter. So: accept the name by sound (not by spelling), recover a short
 * word that starts with the right consonant, and only call it WRONG when the
 * engine clearly heard some other letter; anything else is "try again".
 */
function judgeHebrewLetter(item: LearningItem, alts: RecognitionAlternative[], cfg: EvalConfig): HebrewVerdict {
  const th = cfg.he;
  const own = candidatesOf(item);
  const allLetters = getPack('he').items.filter((l) => l.kind === 'letter' && l.id !== item.id);
  // Letters that are the same sound (ט/ת, א/ע) share their names' spellings:
  // no engine can tell them apart, so neither do we.
  const twins = allLetters.filter((l) => similarity(candidatesOf(l)[0] ?? [], own[0] ?? [], th) >= 0.99);
  const cands = [...own, ...twins.flatMap(candidatesOf)];
  const target1 = firstStrong(cands);
  // Letters that sound the same as the target (בּ/ב…) are not "other" letters.
  const others = allLetters.filter((l) => !twins.includes(l) && bestSimilarity(candidatesOf(l)[0] ?? [], own, th) < 0.85);

  let bestSim = 0;
  let confidentOther = false;
  for (const a of alts) {
    for (const raw of heardStrings(a.transcript)) {
      const latin = /^[a-z]+$/i.test(raw);
      // A drawn-out or doubled sound is the letter: "shhh", "mmm", "לל", "שש".
      const h = latin ? raw.toLowerCase().replace(/(.)\1+/g, '$1') : /^(.)\1+$/.test(raw) ? raw[0] : raw;
      const syms = latin ? latinToSyms(h) : toSyms(h);
      if (!syms.length) continue;
      let mine = latin
        ? Math.max(0, ...cands.map((c) => similarity(syms, strong(c), th)))
        : bestSimilarity(syms, cands, th);
      // The name cut short ("למ", or "למה" for למד): the engine caught the
      // first two-thirds of the name's consonants and lost the end.
      if (th.letterRecoveryMax > 0 && !latin && nameStartOf(syms, cands, th)) mine = Math.max(mine, th.letter.accept);
      const theirs = others.reduce((m, o) => Math.max(m, latin
        ? Math.max(0, ...candidatesOf(o).map((c) => similarity(syms, strong(c), th)))
        : bestSimilarity(syms, candidatesOf(o), th)), 0);
      bestSim = Math.max(bestSim, mine);
      if (mine >= th.letter.accept && mine + 0.05 >= theirs) return { outcome: 'correct' };
      // Contextual recovery: a short word that starts with this letter's sound.
      const st = strong(syms);
      if (th.letterRecoveryMax > 0 && target1 && st.length >= 1 && st.length <= th.letterRecoveryMax
          && similarity([st[0]], [{ c: target1, weak: false }], th) >= 1 - th.flexCost && theirs < th.otherLetterSimilarity) {
        return { outcome: 'correct' };
      }
      if (theirs >= th.otherLetterSimilarity && theirs > mine + 0.05) confidentOther = true;
    }
  }
  if (th.letter.floor >= 1) return { outcome: 'incorrect', reason: 'mismatch' }; // strict mode
  if (confidentOther) return { outcome: 'incorrect', reason: 'mismatch' };
  void bestSim;
  return { outcome: 'uncertain', reason: 'ambiguous' };
}

/** CV syllables: the consonant by sound, the vowel strictly (within what spelling can show). */
function judgeHebrewSyllable(item: LearningItem, alts: RecognitionAlternative[], cfg: EvalConfig): HebrewVerdict {
  const th = cfg.he;
  const tv = syllableVowel(item.display);
  const target = toSyms(item.display.normalize('NFD').replace(/[^\u05D0-\u05EA]/g, '').slice(0, 1));
  const tStrong = strong(target);
  let ambiguous = false;
  let vowelWrong = false;
  for (const a of alts) {
    for (const h of heardStrings(a.transcript)) {
      if (/^[a-z]+$/i.test(h)) continue; // a Latin syllable cannot be checked reliably
      const ev = vowelEvidence(h);
      if (ev === null) { ambiguous = true; continue; }
      const hs = strong(toSyms(h));
      const consonant = tStrong.length === 0 && hs.length === 0 ? 1 : similarity(hs, tStrong, th);
      const vowelOk = !tv || ev.has(tv);
      if (vowelOk && consonant >= th.syllable.accept) return { outcome: 'correct' };
      if (vowelOk && consonant >= th.syllable.floor) ambiguous = true;
      if (!vowelOk && consonant >= th.syllable.accept) vowelWrong = true;
    }
  }
  if (vowelWrong) return { outcome: 'incorrect', reason: 'mismatch' };
  if (ambiguous && th.syllable.floor < 1) return { outcome: 'uncertain', reason: 'ambiguous' };
  return { outcome: 'incorrect', reason: 'mismatch' };
}

/** Words: exact/regex match first (done by the caller), then by sound with a high bar. */
function judgeHebrewWord(item: LearningItem, alts: RecognitionAlternative[], cfg: EvalConfig): HebrewVerdict {
  const th = cfg.he;
  const spellings = [...new Set([item.display, ...item.accepted])];
  let best = 0;
  for (const a of alts) for (const h of heardStrings(a.transcript)) best = Math.max(best, heWordSimilarity(spellings, h, th));
  if (best >= th.word.accept) return { outcome: 'correct' };
  if (best >= th.word.floor && th.word.floor < 1) return { outcome: 'uncertain', reason: 'ambiguous' };
  return { outcome: 'incorrect', reason: 'mismatch' };
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

export function evaluate(item: LearningItem, alternatives: RecognitionAlternative[], cfg: EvalConfig = getEvalConfig()): Evaluation {
  const alts = alternatives.filter((a) => a.transcript && a.transcript.trim());
  if (alts.length === 0) return { outcome: 'uncertain', heard: '', reason: 'silence' };
  const best = alts[0];
  const lowConf = best.confidence !== undefined && best.confidence > 0 && best.confidence < cfg.lowConfidence;

  if (item.kind === 'sentence') {
    let bestRead: boolean[] = [];
    let bestScore = -1;
    for (const a of alts) {
      const read = alignSentence(item, a.transcript, cfg);
      const score = read.filter(Boolean).length / read.length;
      if (score > bestScore) { bestScore = score; bestRead = read; }
    }
    if (bestScore >= cfg.sentenceThreshold) return { outcome: 'correct', heard: best.transcript, wordsRead: bestRead };
    if (lowConf) return { outcome: 'uncertain', heard: best.transcript, reason: 'low-confidence', wordsRead: bestRead };
    return { outcome: 'incorrect', heard: best.transcript, reason: bestScore > 0 ? 'partial' : 'mismatch', wordsRead: bestRead };
  }

  const match = item.lang === 'he' ? hebrewSingleMatch : englishSingleMatch;
  if (alts.some((a) => match(item, a.transcript))) return { outcome: 'correct', heard: best.transcript };

  // Layer 2+: Hebrew is compared by sound, with thresholds per exercise kind.
  if (item.lang === 'he') {
    const bareConsonant = item.kind === 'syllable' && normalizeHebrew(best.transcript).replace(/ /g, '').length === 1;
    if (!bareConsonant) {
      const v = item.kind === 'letter' ? judgeHebrewLetter(item, alts, cfg)
        : item.kind === 'syllable' ? judgeHebrewSyllable(item, alts, cfg)
        : judgeHebrewWord(item, alts, cfg);
      if (v.outcome === 'correct') return { outcome: 'correct', heard: best.transcript };
      if (v.outcome === 'uncertain') return { outcome: 'uncertain', heard: best.transcript, reason: v.reason };
    }
  }

  // Not a match. Decide whether we actually know the child read it wrong.
  if (lowConf) return { outcome: 'uncertain', heard: best.transcript, reason: 'low-confidence' };
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

/* ------------------------------------------------------------- prefixes */

/**
 * How much of the target word a heard *beginning* covers, 0 if it is not a
 * beginning of the target at all. "שול" for שֻׁלְחָן → 0.75; "קו" for קוֹף → 0.67;
 * "קום" for קוֹף → 0 (a different, complete word is not a beginning).
 *
 * Only words are guessed: letters and syllables are already whole after one
 * sound, and a sentence is matched word by word.
 */
export function prefixCoverage(item: LearningItem, heardToken: string, cfg: EvalConfig = getEvalConfig()): number {
  if (item.kind !== 'word') return 0;
  const p = cfg.prefix;
  if (item.lang === 'en') {
    const h = normalizeEnglish(heardToken).replace(/[^a-z]/g, '');
    const target = item.display.toLowerCase();
    if (h.length < Math.max(3, p.minHeard) || target.length < Math.max(4, p.minTarget + 1)) return 0;
    if (h.length >= target.length || !target.startsWith(h)) return 0;
    return h.length / target.length;
  }
  const h = normalizeHebrew(heardToken).replace(/ /g, '');
  if (!h || /^[a-z]+$/i.test(h)) return 0;
  const heard = strong(toSyms(h));
  let best = 0;
  for (const spelling of new Set([...item.accepted, item.display])) {
    const target = strong(toSyms(spelling));
    if (target.length < p.minTarget || heard.length < p.minHeard || heard.length >= target.length) continue;
    if (similarity(heard, target.slice(0, heard.length), cfg.he) >= p.similarity) best = Math.max(best, heard.length / target.length);
  }
  return best;
}
