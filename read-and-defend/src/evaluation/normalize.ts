import { HOMOPHONES } from '../content/english/data';
import { normalizeFinals, stripNiqqud } from '../content/hebrew/script';

/* ------------------------------------------------------------------ English */

const NUMBER_WORDS: Record<string, string> = {
  '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six',
  '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten',
};

/** Lowercase, drop punctuation, expand digits, collapse whitespace. */
export function normalizeEnglish(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\b\d+\b/g, (d) => NUMBER_WORDS[d] ?? d)
    .replace(/[^a-z' ]+/g, ' ')
    .replace(/'(?![a-z])/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const HOMOPHONE_INDEX = new Map<string, Set<string>>();
for (const group of HOMOPHONES) {
  const norm = group.map(normalizeEnglish);
  for (const w of norm) {
    const set = HOMOPHONE_INDEX.get(w) ?? new Set<string>();
    norm.forEach((x) => set.add(x));
    HOMOPHONE_INDEX.set(w, set);
  }
}

/** The word plus every spelling a recogniser may use for the same sounds. */
export function englishSoundAlikes(word: string): Set<string> {
  const w = normalizeEnglish(word);
  return new Set([w, ...(HOMOPHONE_INDEX.get(w) ?? [])]);
}

/** Words children (and recognisers) wrap around an answer. */
export const EN_FILLERS = new Set(['um', 'uh', 'er', 'erm', 'hmm', 'the', 'letter', 'sound', 'its', "it's", 'it', 'is', 'says', 'that', 'like', 'oh', 'okay', 'ok']);

/* ------------------------------------------------------------------- Hebrew */

/** Strip niqqud, normalise final letters, drop punctuation and geresh. */
export function normalizeHebrew(s: string): string {
  return normalizeFinals(stripNiqqud(s))
    .replace(/[׳״'"`״׳]/g, '')
    .replace(/[^א-תa-zA-Z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const HE_FILLERS = new Set(['אה', 'אמ', 'אממ', 'אהה', 'זה', 'כאילו', 'נו', 'אוקיי', 'האות']);

const CONS: Record<string, string> = {
  'ב': '(?:b|v)', 'ג': '(?:g|j)', 'ד': 'd', 'ז': '(?:z|j)', 'ח': 'kh', 'ט': 't', 'כ': '(?:k|kh)',
  'ל': 'l', 'מ': 'm', 'נ': 'n', 'ס': 's', 'פ': '(?:p|f)', 'צ': '(?:ts|tsh|ch)', 'ק': 'k', 'ר': 'r',
  'ש': '(?:sh|s)', 'ת': 't',
};
const HARD: Record<string, string> = { 'ב': 'b', 'כ': 'k', 'פ': 'p' };

/**
 * A regular expression matching every plausible reading of an unpointed
 * Hebrew word, as a modern recogniser spells it. Unpointed text is genuinely
 * ambiguous (ספר is sefer, sapar…), so a recogniser's spelling is checked by
 * asking "could this spelling be read as the target's pronunciation?" —
 * never by stripping letters until two strings happen to look alike.
 *
 * Modern (plene) spelling writes o and u with vav and most i with yod, so a
 * vowel with no letter is taken to be a or e — except in the first syllable
 * of longer words (מכתב, מספר), where a bare i is normal. A word-initial
 * alef or ayin always carries a vowel.
 */
export function hebrewReadingRegex(word: string): RegExp {
  const letters = [...normalizeHebrew(word).replace(/ /g, '')];
  const firstV = letters.length >= 3 ? '[aeiou]?' : '[ae]?';
  let re = '';
  letters.forEach((ch, i) => {
    const last = i === letters.length - 1;
    const first = i === 0;
    const V = first ? firstV : '[ae]?';
    switch (ch) {
      case 'א': case 'ע': re += first ? '[aeiou]' : last ? (ch === 'א' ? 'a' : '(?:a|e)?') : V; break;
      case 'ה': re += last ? '(?:a|e|h)' : `h${V}`; break;
      case 'ו': re += first ? `(?:v${V}|u)` : last ? '(?:v|o|u)' : `(?:v${V}|o|u)`; break;
      case 'י': re += first ? `y${V}` : last ? '(?:i|y|ey|ay)' : `(?:y${V}|i|e|ey|ay)`; break;
      default:
        // בּ כּ פּ at the start of a word take dagesh: always b, k, p.
        re += (first && HARD[ch] ? HARD[ch] : CONS[ch] ?? '') + (last ? '' : V);
    }
  });
  return new RegExp(`^${re}$`);
}

/** Two phonetic strings that differ only in a dropped light "e" (shva). */
export function shvaVariants(phon: string): string[] {
  const out = new Set([phon]);
  // Initial vocal shva: "yeladim" may be heard as "yladim".
  const m = /^([^aeiou]+)e(.*)$/.exec(phon);
  if (m) out.add(m[1] + m[2]);
  return [...out];
}

/** Latin transliteration a recogniser sometimes returns ("shalom"). */
export function normalizeLatinPhonetic(s: string): string {
  return s.toLowerCase().replace(/ch/g, 'kh').replace(/tz/g, 'ts').replace(/[^a-z]/g, '');
}
