/**
 * Hebrew script utilities: parse vocalised text into letters with their
 * points, strip niqqud, and derive a phonetic reading.
 *
 * The phonetic form is Modern Israeli pronunciation in a simple Latin scheme
 * (b v g d h z kh t y k l m n s p f ts r sh, vowels a e i o u). It is used to
 * compare syllables, where a recogniser's spelling of "ba" might be בא or בה.
 */

export const NIQQUD = {
  SHVA: 'ְ',
  HATAF_SEGOL: 'ֱ',
  HATAF_PATAH: 'ֲ',
  HATAF_QAMATS: 'ֳ',
  HIRIQ: 'ִ',
  TSERE: 'ֵ',
  SEGOL: 'ֶ',
  PATAH: 'ַ',
  QAMATS: 'ָ',
  HOLAM: 'ֹ',
  HOLAM_HASER_VAV: 'ֺ',
  QUBUTS: 'ֻ',
  DAGESH: 'ּ',
  SHIN_DOT: 'ׁ',
  SIN_DOT: 'ׂ',
} as const;

/** Every combining mark used in vocalised Hebrew (points + cantillation). */
const MARKS_RE = /[֑-ֽֿ-ׇ]/g;

export const isHebrewLetter = (ch: string): boolean => ch >= 'א' && ch <= 'ת';

export function stripNiqqud(s: string): string {
  return s.normalize('NFC').replace(MARKS_RE, '');
}

const FINAL_TO_REGULAR: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
export const REGULAR_TO_FINAL: Record<string, string> = { 'כ': 'ך', 'מ': 'ם', 'נ': 'ן', 'פ': 'ף', 'צ': 'ץ' };

export function normalizeFinals(s: string): string {
  return s.replace(/[ךםןףץ]/g, (c) => FINAL_TO_REGULAR[c]);
}

export interface PointedLetter {
  letter: string;
  dagesh: boolean;
  shinDot: boolean;
  sinDot: boolean;
  /** Vowel point on this letter, if any (excluding holam on vav, see below). */
  vowel: string | null;
  holam: boolean;
}

/** Split vocalised text (one word) into letters with their points. */
export function parsePointed(word: string): PointedLetter[] {
  const out: PointedLetter[] = [];
  // NFD keeps every point as its own code point in canonical order.
  for (const ch of word.normalize('NFD')) {
    if (isHebrewLetter(ch)) {
      out.push({ letter: ch, dagesh: false, shinDot: false, sinDot: false, vowel: null, holam: false });
      continue;
    }
    const cur = out[out.length - 1];
    if (!cur) continue;
    switch (ch) {
      case NIQQUD.DAGESH: cur.dagesh = true; break;
      case NIQQUD.SHIN_DOT: cur.shinDot = true; break;
      case NIQQUD.SIN_DOT: cur.sinDot = true; break;
      case NIQQUD.HOLAM:
      case NIQQUD.HOLAM_HASER_VAV: cur.holam = true; break;
      default:
        if (ch >= NIQQUD.SHVA && ch <= NIQQUD.QUBUTS) cur.vowel = ch;
    }
  }
  return out;
}

export type VowelClass = 'a' | 'e' | 'i' | 'o' | 'u' | 'shva';

export function vowelClass(v: string | null): VowelClass | null {
  switch (v) {
    case NIQQUD.QAMATS: case NIQQUD.PATAH: case NIQQUD.HATAF_PATAH: return 'a';
    case NIQQUD.TSERE: case NIQQUD.SEGOL: case NIQQUD.HATAF_SEGOL: return 'e';
    case NIQQUD.HIRIQ: return 'i';
    case NIQQUD.HATAF_QAMATS: return 'o';
    case NIQQUD.QUBUTS: return 'u';
    case NIQQUD.SHVA: return 'shva';
    default: return null;
  }
}

/** Consonant sound of a pointed letter, ignoring vowels. */
export function consonantSound(p: PointedLetter): string {
  switch (p.letter) {
    case 'א': case 'ע': return '';
    case 'ב': return p.dagesh ? 'b' : 'v';
    case 'ג': return 'g';
    case 'ד': return 'd';
    case 'ה': return 'h';
    case 'ו': return 'v';
    case 'ז': return 'z';
    case 'ח': return 'kh';
    case 'ט': case 'ת': return 't';
    case 'י': return 'y';
    case 'כ': case 'ך': return p.dagesh ? 'k' : 'kh';
    case 'ק': return 'k';
    case 'ל': return 'l';
    case 'מ': case 'ם': return 'm';
    case 'נ': case 'ן': return 'n';
    case 'ס': return 's';
    case 'פ': case 'ף': return p.dagesh ? 'p' : 'f';
    case 'צ': case 'ץ': return 'ts';
    case 'ר': return 'r';
    case 'ש': return p.sinDot ? 's' : 'sh';
    default: return '';
  }
}

export interface LetterRole {
  p: PointedLetter;
  /** 'cons' = pronounced consonant; 'mater' = silent vowel letter;
   * 'vowel' = vav acting as o/u. */
  role: 'cons' | 'mater' | 'vowel';
  /** Vowel sound this letter contributes after its consonant ('' if none). */
  vowel: string;
  /** Skill-level vowel class carried by the letter, if any. */
  vowelSkill: VowelClass | null;
}

/** Decide, letter by letter, how a vocalised word is read. */
export function analyseWord(word: string): LetterRole[] {
  const ps = parsePointed(word);
  const roles: LetterRole[] = [];
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    const prev = roles[roles.length - 1];
    const prevHasVowel = prev ? prev.vowel !== '' || prev.role !== 'cons' : true;
    const isLast = i === ps.length - 1;

    if (p.letter === 'ו' && prev && !prevHasVowel) {
      if (p.holam && !p.vowel) { prev.vowel = 'o'; prev.vowelSkill = 'o'; roles.push({ p, role: 'vowel', vowel: '', vowelSkill: null }); continue; }
      if (p.dagesh && !p.vowel) { prev.vowel = 'u'; prev.vowelSkill = 'u'; roles.push({ p, role: 'vowel', vowel: '', vowelSkill: null }); continue; }
    }
    if (p.letter === 'ו' && !prev && p.dagesh && !p.vowel) {
      // Word-initial shuruk: the conjunction "u".
      roles.push({ p, role: 'vowel', vowel: 'u', vowelSkill: 'u' });
      continue;
    }
    // Silent yod after hiriq / tsere / segol (hiriq male, tsere male).
    if (p.letter === 'י' && !p.vowel && !p.dagesh && prev && prev.role === 'cons'
        && (prev.vowelSkill === 'i' || prev.vowelSkill === 'e')) {
      roles.push({ p, role: 'mater', vowel: '', vowelSkill: null });
      continue;
    }
    // Word-final he / alef without a point of their own are silent.
    if ((p.letter === 'ה' || p.letter === 'א') && isLast && !p.vowel && !p.dagesh) {
      roles.push({ p, role: 'mater', vowel: '', vowelSkill: null });
      continue;
    }
    // Silent alef inside a word, e.g. רֹאשׁ, לֹא.
    if (p.letter === 'א' && !p.vowel && prev && prev.role === 'cons' && prevHasVowel) {
      roles.push({ p, role: 'mater', vowel: '', vowelSkill: null });
      continue;
    }
    let vc = vowelClass(p.vowel);
    if (p.holam && p.letter !== 'ו') vc = 'o';
    if (p.holam && p.letter === 'ו' && p.vowel === null && (!prev || prevHasVowel)) {
      // Consonantal vav carrying holam haser (rare) – "vo".
      vc = 'o';
    }
    let vowel = vc === null || vc === 'shva' ? '' : vc;
    // Vocal shva at the start of a word is pronounced (lightly) as "e".
    if (vc === 'shva' && i === 0) vowel = 'e';
    roles.push({ p, role: 'cons', vowel, vowelSkill: vc });
  }
  return roles;
}

/**
 * Phonetic reading of one vocalised word. Patah under a word-final guttural
 * (patah genuva) is read before the consonant: רוּחַ → ruakh.
 */
export function phoneticWord(word: string): string {
  const roles = analyseWord(word);
  let out = '';
  roles.forEach((r, i) => {
    if (r.role !== 'cons') { out += r.vowel; return; }
    const c = consonantSound(r.p);
    const isLast = i === roles.length - 1;
    if (isLast && r.vowel === 'a' && (r.p.letter === 'ח' || r.p.letter === 'ע' || (r.p.letter === 'ה' && r.p.dagesh))) {
      out += 'a' + c;
    } else {
      out += c + r.vowel;
    }
  });
  return out;
}

export function phonetic(text: string): string {
  return text.split(/\s+/).filter(Boolean).map(phoneticWord).join(' ');
}

/**
 * Full (plene) spelling, as a modern recogniser writes the word: hiriq gains
 * a yod, qubuts and holam haser gain a vav. Points are then stripped.
 */
export function plene(word: string): string {
  const roles = analyseWord(word);
  let out = '';
  roles.forEach((r, i) => {
    out += r.p.letter;
    const next = roles[i + 1];
    if (r.role !== 'cons') return;
    const nextIsMater = next && next.role !== 'cons';
    // Hiriq takes a yod in an open syllable (next letter carries a full
    // vowel): כִּתָּה → כיתה, but מִכְתָּב → מכתב and עִם → עם stay closed.
    const nextOpen = next && next.role === 'cons' && next.vowel !== '' && !(next.vowelSkill === 'shva');
    if (r.p.vowel === NIQQUD.HIRIQ && r.p.letter !== 'י' && !nextIsMater && nextOpen) out += 'י';
    if (r.p.vowel === NIQQUD.QUBUTS && !nextIsMater) out += 'ו';
    if (r.p.holam && r.p.letter !== 'ו' && !nextIsMater && next) out += 'ו';
  });
  return out;
}
