import type { LanguagePack, LearningItem, Skill, Unit } from '../types';
import { LETTERS, SENTENCES, VOWELS, WORDS } from './data';
import { analyseWord, NIQQUD, phonetic, plene, stripNiqqud, type PointedLetter } from './script';

const L = (form: string) => `he:L:${form}`;
const V = (v: string) => `he:V:${v}`;
const P_SILENT = 'he:P:silent';
const P_PLAIN = 'he:P:plain';

/** The letter skill a pointed letter exercises (בּ and ב are different sounds). */
export function letterSkill(p: PointedLetter): string {
  const l = p.letter;
  if (l === 'ב' || l === 'כ' || l === 'פ') return L(p.dagesh ? `${l}ּ` : l);
  if (l === 'ש') return L(p.sinDot ? 'שׂ' : 'שׁ');
  return L(l);
}

const HATAF = new Set<string>([NIQQUD.HATAF_PATAH, NIQQUD.HATAF_SEGOL, NIQQUD.HATAF_QAMATS]);

/** Every skill needed to decode one pointed word. */
export function hebrewWordSkills(word: string): string[] {
  const roles = analyseWord(word);
  const skills = new Set<string>();
  roles.forEach((r, i) => {
    const isLast = i === roles.length - 1;
    if (r.role === 'mater') {
      if (r.p.letter === 'ה' || r.p.letter === 'א') skills.add(P_SILENT);
      return; // silent yod after hiriq/tsere is part of that vowel
    }
    if (r.role === 'vowel') { if (r.vowelSkill) skills.add(V(r.vowelSkill)); return; }
    skills.add(letterSkill(r.p));
    if (r.vowelSkill && !(r.vowelSkill === 'shva' && isLast)) skills.add(V(r.vowelSkill));
    if (r.p.vowel && HATAF.has(r.p.vowel)) skills.add(V('shva'));
  });
  return [...skills];
}

/** Syllable breakdown of a pointed word, for the "sound it out" hint. */
export function hebrewSyllables(word: string): string[] {
  const roles = analyseWord(word);
  // Re-group the original code points per letter so points stay attached.
  const clusters: string[] = [];
  for (const ch of word.normalize('NFD')) {
    if (ch >= '\u05D0' && ch <= '\u05EA') clusters.push(ch);
    else if (clusters.length) clusters[clusters.length - 1] += ch;
  }
  const parts: string[] = [];
  roles.forEach((r, i) => {
    const next = roles[i + 1];
    // A consonant opens a syllable when it is pronounced with a vowel —
    // its own point, or a following vav read as o/u.
    const opens = r.role === 'cons' && (r.vowel !== '' || (next !== undefined && next.role === 'vowel'));
    if (opens || parts.length === 0) parts.push(clusters[i] ?? '');
    else parts[parts.length - 1] += clusters[i] ?? '';
  });
  return parts.map((p) => p.normalize('NFC'));
}

function buildSkills(): Record<string, Skill> {
  const skills: Record<string, Skill> = {};
  for (const l of LETTERS) {
    skills[L(l.form)] = { id: L(l.form), lang: 'he', kind: 'grapheme', display: l.form, label: `האות ${l.name}`, example: l.example };
  }
  for (const [k, v] of Object.entries(VOWELS)) {
    skills[V(k)] = { id: V(k), lang: 'he', kind: 'vowel', display: v.marks.map((m) => (m.length === 1 ? `ב${m}` : `ב${m}`)).join(' '), label: v.label };
  }
  skills[P_SILENT] = { id: P_SILENT, lang: 'he', kind: 'pattern', display: 'מָה', label: 'אוֹת שֶׁלֹּא נִשְׁמַעַת (ה, א בסוף מילה)' };
  skills[P_PLAIN] = { id: P_PLAIN, lang: 'he', kind: 'pattern', display: 'שלום', label: 'קריאה בלי ניקוד' };
  return skills;
}

/** CV syllables: every consonant with every vowel sign. Rule-generated, always valid. */
function buildSyllables(): LearningItem[] {
  const items: LearningItem[] = [];
  const signs: Array<{ v: string; mark: string; male?: boolean }> = [
    { v: 'a', mark: NIQQUD.QAMATS }, { v: 'a', mark: NIQQUD.PATAH },
    { v: 'i', mark: NIQQUD.HIRIQ },
    { v: 'o', mark: 'וֹ', male: true }, { v: 'o', mark: NIQQUD.HOLAM },
    { v: 'u', mark: 'וּ', male: true }, { v: 'u', mark: NIQQUD.QUBUTS },
    { v: 'e', mark: NIQQUD.TSERE }, { v: 'e', mark: NIQQUD.SEGOL },
  ];
  for (const l of LETTERS) {
    if ('ךםןףץ'.includes(l.form)) continue; // final forms never carry a vowel in CV drills
    for (const s of signs) {
      if (s.male && l.form === 'ו') continue;
      const display = (l.form + s.mark).normalize('NFC');
      items.push({
        id: `he:syl:${display}`, lang: 'he', kind: 'syllable', display, accepted: [],
        parts: [display], skills: [L(l.form), V(s.v)], difficulty: s.male ? 2 : 2.2,
        pattern: 'CV', niqqud: true, isRealWord: false, speakAs: display, strict: true,
      });
    }
  }
  return items;
}

function wordDifficulty(word: string, skills: string[]): number {
  const syl = hebrewSyllables(word).length;
  const letters = analyseWord(word).length;
  let d = 2.6 + 0.5 * syl + 0.15 * letters;
  if (skills.includes(V('shva'))) d += 0.8;
  return Math.round(d * 10) / 10;
}

function buildItems(): LearningItem[] {
  const items: LearningItem[] = [];
  for (const l of LETTERS) {
    items.push({
      id: `he:letter:${l.form}`, lang: 'he', kind: 'letter', display: l.form,
      accepted: [l.form, stripNiqqud(l.name), ...l.heard], parts: [l.form], skills: [L(l.form)],
      difficulty: 'ךםןףץ'.includes(l.form) ? 1.4 : 1, isRealWord: false, speakAs: l.name, strict: true,
    });
  }
  items.push(...buildSyllables());
  for (const w of new Set(WORDS)) {
    const display = w.normalize('NFC');
    const skills = hebrewWordSkills(display);
    const difficulty = wordDifficulty(display, skills);
    const variants = [...new Set([stripNiqqud(display), plene(display)])];
    const parts = hebrewSyllables(display);
    items.push({
      id: `he:word:${display}`, lang: 'he', kind: 'word', display, accepted: variants, parts, skills,
      difficulty, niqqud: true, isRealWord: true, speakAs: display, strict: difficulty < 4,
      pattern: `${parts.length}syl`,
    });
    // Reduced-niqqud form for stage 5: the same word, unpointed.
    items.push({
      id: `he:plain:${display}`, lang: 'he', kind: 'word', display: plene(display), accepted: variants, parts: [plene(display)],
      skills: [...skills, P_PLAIN], difficulty: difficulty + 2, niqqud: false, isRealWord: true,
      speakAs: display, strict: false, pattern: `${parts.length}syl`,
    });
  }
  for (const s of SENTENCES) {
    const display = s.normalize('NFC');
    const words = display.replace(/[.,!?]/g, '').split(/\s+/).filter(Boolean);
    const skills = new Set<string>();
    words.forEach((w) => hebrewWordSkills(w).forEach((k) => skills.add(k)));
    items.push({
      id: `he:sent:${stripNiqqud(words.join('-'))}`, lang: 'he', kind: 'sentence', display,
      accepted: [stripNiqqud(display)], parts: words, skills: [...skills],
      difficulty: Math.round((7 + words.length * 0.5) * 10) / 10, niqqud: true, isRealWord: true,
      speakAs: display, strict: false,
    });
  }
  return items;
}

const Ls = (...forms: string[]) => forms.map(L);

/**
 * Unit 1 (the first two levels) teaches letters only, as the game first
 * shipped. From unit 2 on the monsters carry real words — there are no
 * separate syllable drills: the vowels and the remaining letters are learned
 * by reading words built from them.
 */
const UNITS: Unit[] = [
  { id: 'he-1', stage: 1, newSkills: Ls('בּ', 'מ', 'ל', 'שׁ'), kinds: { letter: 1 }, maxDifficulty: 1, title: { he: 'אוֹתִיּוֹת רִאשׁוֹנוֹת', en: 'First letters' } },
  { id: 'he-2', stage: 1, newSkills: [...Ls('ד', 'ת', 'נ', 'ר', 'א'), V('a')], kinds: { letter: 1, word: 0.4 }, maxDifficulty: 4.5, title: { he: 'עוֹד אוֹתִיּוֹת וְקָמָץ', en: 'More letters, and the "a" vowel' } },
  { id: 'he-3', stage: 2, newSkills: [...Ls('ג', 'ה', 'י', 'ס'), V('i'), P_SILENT], kinds: { word: 1, letter: 0.4 }, maxDifficulty: 4.5, title: { he: 'חִירִיק וּמִלִּים רִאשׁוֹנוֹת', en: 'The "i" vowel and first words' } },
  { id: 'he-4', stage: 3, newSkills: [...Ls('ם', 'ן', 'כּ', 'פּ', 'ק', 'ט', 'ע'), V('o')], kinds: { word: 1, letter: 0.3 }, maxDifficulty: 4.8, title: { he: 'חוֹלָם', en: 'The "o" vowel' } },
  { id: 'he-5', stage: 3, newSkills: [...Ls('ח', 'ז', 'צ', 'ו'), V('u')], kinds: { word: 1, letter: 0.3 }, maxDifficulty: 5, title: { he: 'שׁוּרוּק וְקֻבּוּץ', en: 'The "u" vowel' } },
  { id: 'he-6', stage: 3, newSkills: [...Ls('ב', 'כ', 'פ', 'שׂ', 'ך', 'ף', 'ץ'), V('e')], kinds: { word: 1, letter: 0.3 }, maxDifficulty: 5.2, title: { he: 'צֵירֵה וְסֶגּוֹל', en: 'The "e" vowel' } },
  { id: 'he-7', stage: 4, newSkills: [], transfer: true, kinds: { word: 1 }, maxDifficulty: 5.2, title: { he: 'מְגַלִּים מִלִּים חֲדָשׁוֹת', en: 'Explorer: new words' } },
  { id: 'he-8', stage: 5, newSkills: [V('shva')], kinds: { word: 1 }, maxDifficulty: 6.5, title: { he: 'שְׁוָא וּמִלִּים אֲרֻכּוֹת', en: 'Shva and longer words' } },
  { id: 'he-9', stage: 5, newSkills: [P_PLAIN], transfer: true, reducedNiqqud: true, kinds: { word: 1 }, maxDifficulty: 7, title: { he: 'קְרִיאָה בְּלִי נִקּוּד', en: 'Reading without niqqud' } },
  { id: 'he-10', stage: 6, newSkills: [], kinds: { sentence: 0.4, word: 1 }, maxDifficulty: 10, title: { he: 'מִשְׁפָּטִים רִאשׁוֹנִים', en: 'First sentences' } },
  { id: 'he-11', stage: 6, newSkills: [], kinds: { sentence: 0.7, word: 1 }, maxDifficulty: 10, title: { he: 'זְמַן סִפּוּר', en: 'Story time' } },
];

export function buildHebrewPack(): LanguagePack {
  return { lang: 'he', dir: 'rtl', speechLang: 'he-IL', skills: buildSkills(), units: UNITS, items: buildItems(), bossFreeSkills: [] };
}

export { phonetic };
