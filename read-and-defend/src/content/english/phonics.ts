/**
 * English phonics: grapheme inventory and a parser that splits a word into the
 * graphemes a beginning reader decodes (s-h-i-p is wrong; sh-i-p is right).
 */

/** Multi-letter graphemes, longest first so the greedy parser prefers them. */
export const MULTI_GRAPHEMES = [
  'sh', 'ch', 'th', 'ck', 'ng', 'qu', 'wh',
  'ee', 'oo', 'ai', 'oa', 'ar', 'or', 'ay',
  'll', 'ss', 'ff', 'zz',
];

/** Split-digraph ("magic e") graphemes, written a_e etc. */
export const SPLIT_DIGRAPHS = ['a_e', 'i_e', 'o_e', 'u_e', 'e_e'];

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

export function isVowelGrapheme(g: string): boolean {
  return VOWELS.has(g) || SPLIT_DIGRAPHS.includes(g) || ['ee', 'oo', 'ai', 'oa', 'ar', 'or', 'ay'].includes(g);
}

/** Parse a lowercase word into graphemes. CVCe words yield a split digraph. */
export function parseGraphemes(word: string): string[] {
  const w = word.toLowerCase();
  const cvce = /^([^aeiou]*)([aeiou])([^aeiou])e$/.exec(w);
  if (cvce && w.length >= 4) {
    const [, onset, v, c] = cvce;
    return [...parseGraphemes(onset), `${v}_e`, c];
  }
  const out: string[] = [];
  let i = 0;
  while (i < w.length) {
    const two = w.slice(i, i + 2);
    if (MULTI_GRAPHEMES.includes(two)) { out.push(two); i += 2; continue; }
    out.push(w[i]);
    i += 1;
  }
  return out;
}

/** Structural pattern: C/V per grapheme, collapsed (e.g. "CCVC"). */
export function patternOf(graphemes: string[]): string {
  if (graphemes.some((g) => SPLIT_DIGRAPHS.includes(g))) return 'CVCe';
  return graphemes.map((g) => (isVowelGrapheme(g) ? 'V' : 'C')).join('');
}

/** True when the word holds a consonant cluster (blend) of two graphemes. */
export function hasBlend(graphemes: string[]): boolean {
  for (let i = 0; i < graphemes.length - 1; i++) {
    if (!isVowelGrapheme(graphemes[i]) && !isVowelGrapheme(graphemes[i + 1])) return true;
  }
  return false;
}
