import { analyseWord } from '../content/hebrew/script';
import { normalizeHebrew } from './normalize';
import type { HebrewEvalConfig } from './config';

/**
 * Hebrew phonetic comparison.
 *
 * A recogniser returns *spelling*, and spelling is a lossy record of sound:
 * ט and ת are one sound, כ may be k or kh, ב may be b or v, א ע and often ה
 * are silent, and ו י are sometimes consonants and sometimes vowels. So we
 * compare letters by the sound class they stand for, with a weighted edit
 * distance in which
 *   - same sound            costs 0,
 *   - one sound, two spellings (כ/ק, ב/ו)       costs a little,
 *   - acoustically close consonants (b/p, d/t…) costs more,
 *   - a vowel letter that may or may not be written costs half an insertion.
 */

export interface Sym {
  /** Sound class. */
  c: string;
  /** A vowel letter / silent letter: may be present or absent. */
  weak: boolean;
}

const CLASS: Record<string, string> = {
  'א': 'a', 'ע': 'a', 'ה': 'h', 'ו': 'v', 'י': 'y',
  'ב': 'b', 'ג': 'g', 'ד': 'd', 'ז': 'z', 'ח': 'x', 'ט': 't', 'כ': 'c', 'ל': 'l',
  'מ': 'm', 'נ': 'n', 'ס': 's', 'פ': 'p', 'צ': 'q', 'ק': 'k', 'ר': 'r', 'ש': 'S', 'ת': 't',
};

/** Spellings of one sound that recognisers use interchangeably. */
const FLEX = new Set(['c|k', 'b|v']);
/** Consonants that are commonly confused with each other by recognisers. */
const NEAR = new Set(['b|p', 'd|t', 'g|k', 'z|s', 'm|n', 'c|x', 'k|t', 'S|s', 'q|s', 'h|x', 'l|n', 'k|x']);

const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Letters → sound symbols. `weakPositions` follows spelling conventions: a
 * vav or yod after the first letter, a final he/alef, and every alef/ayin are
 * vowel carriers.
 */
export function toSyms(text: string): Sym[] {
  const letters = [...normalizeHebrew(text).replace(/ /g, '')].filter((ch) => CLASS[ch] || ch === 'ך');
  return letters.map((ch, i) => {
    const c = CLASS[ch];
    const last = i === letters.length - 1;
    const weak = c === 'a' || ((c === 'v' || c === 'y') && i > 0) || (c === 'h' && last && letters.length > 1);
    return { c, weak };
  });
}

export const strong = (s: Sym[]): Sym[] => s.filter((x) => !x.weak);

function subCost(a: Sym, b: Sym, cfg: HebrewEvalConfig): number {
  if (a.weak !== b.weak) return 1;
  if (a.c === b.c) return 0;
  // Between two vowel/silent letters: א↔ה are both just "a/e" to a recogniser,
  // but ו↔י are different vowels (u/o vs i/e) and must stay different.
  if (a.weak) return (a.c === 'a' && b.c === 'h') || (a.c === 'h' && b.c === 'a') ? 0.3 : 1;
  const p = pair(a.c, b.c);
  if (FLEX.has(p)) return cfg.flexCost;
  if (NEAR.has(p)) return cfg.nearCost;
  return 1;
}

/**
 * Cost of a letter being present in one spelling and absent in the other.
 * Only the silent letters א/ע are cheap: ו and י write a vowel (kara vs kora
 * are different words) and a final ה writes an ending (gadol vs gdola).
 * Legitimate plene/defective spellings of the *same* word are handled by the
 * exact layer, which knows the word, before this one runs.
 */
const indel = (s: Sym) => (!s.weak ? 1 : s.c === 'a' ? 0.5 : s.c === 'h' ? 0.8 : 1);

/** Weighted Levenshtein distance between two symbol strings. */
export function distance(a: Sym[], b: Sym[], cfg: HebrewEvalConfig): number {
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  prev[0] = 0;
  for (let j = 1; j <= b.length; j++) prev[j] = prev[j - 1] + indel(b[j - 1]);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = prev[0] + indel(a[i - 1]);
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + indel(a[i - 1]), cur[j - 1] + indel(b[j - 1]), prev[j - 1] + subCost(a[i - 1], b[j - 1], cfg));
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

/** 1 = same sounds; 0 = nothing in common. */
export function similarity(a: Sym[], b: Sym[], cfg: HebrewEvalConfig): number {
  const len = Math.max(a.length, b.length);
  if (len === 0) return 0;
  return Math.max(0, 1 - distance(a, b, cfg) / len);
}

/* ---------------------------------------------------------------- letters */

/** Words a letter name is commonly transcribed as, and the letter itself. */
export function letterCandidates(display: string, accepted: string[]): Sym[][] {
  const out: Sym[][] = [];
  const seen = new Set<string>();
  for (const a of [display, ...accepted]) {
    // "סופית" ("final") is in every final-letter name; it says nothing about which letter.
    const s = toSyms(normalizeHebrew(a).split(' ').filter((w) => w !== 'סופית' && w !== 'סופי').join(' '));
    const key = s.map((x) => x.c + (x.weak ? '~' : '')).join('');
    if (s.length && !seen.has(key)) { seen.add(key); out.push(s); }
  }
  return out;
}

/** Best similarity of a heard string against a set of candidate spellings. */
export function bestSimilarity(heard: Sym[], candidates: Sym[][], cfg: HebrewEvalConfig): number {
  let best = 0;
  for (const c of candidates) best = Math.max(best, similarity(heard, c, cfg));
  return best;
}

/* -------------------------------------------------------------- syllables */

export type VowelKey = 'a' | 'e' | 'i' | 'o' | 'u';

/** The vowel a pointed CV syllable carries. */
export function syllableVowel(display: string): VowelKey | null {
  const r = analyseWord(display)[0];
  const v = r?.vowel as VowelKey | '' | undefined;
  return v ? v : null;
}

/**
 * Which vowels could a recogniser's spelling stand for? Spelling shows o/u
 * (vav) and i (yod) reasonably well; an unwritten vowel or a final he/alef
 * is a/e — recognisers cannot tell those apart, so neither do we.
 */
export function vowelEvidence(heard: string): Set<VowelKey> | null {
  const letters = [...normalizeHebrew(heard).replace(/ /g, '')];
  if (letters.length <= 1) return null; // a bare consonant says nothing about the vowel
  const rest = letters.slice(1);
  if (rest.includes('ו')) return new Set<VowelKey>(['o', 'u']);
  if (rest.includes('י')) return new Set<VowelKey>(['i', 'e']);
  return new Set<VowelKey>(['a', 'e']);
}

/* ------------------------------------------------------------------ latin */

/** Latin transliteration a recogniser sometimes returns ("shalom") → strong sound symbols. */
export function latinToSyms(text: string): Sym[] {
  let t = text.toLowerCase().replace(/[^a-z]/g, '');
  const out: Sym[] = [];
  const push = (c: string) => out.push({ c, weak: false });
  while (t.length) {
    const two = t.slice(0, 2);
    if (two === 'sh') { push('S'); t = t.slice(2); continue; }
    if (two === 'kh' || two === 'ch') { push('x'); t = t.slice(2); continue; }
    if (two === 'ts' || two === 'tz') { push('q'); t = t.slice(2); continue; }
    const ch = t[0];
    t = t.slice(1);
    const map: Record<string, string> = { b: 'b', v: 'b', w: 'b', p: 'p', f: 'p', g: 'g', j: 'g', d: 'd', t: 't', k: 'k', c: 'k', q: 'k', z: 'z', s: 's', m: 'm', n: 'n', l: 'l', r: 'r', h: 'h', y: 'y', x: 'k' };
    if (map[ch]) push(map[ch]);
  }
  return out;
}
