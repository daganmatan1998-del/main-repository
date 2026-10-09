import type { LanguagePack, LearningItem, Skill, Unit } from '../types';
import { CHUNKS, KEYWORDS, LETTER_NAMES, SENTENCES, TRICKY, WORDS } from './data';
import { hasBlend, isVowelGrapheme, MULTI_GRAPHEMES, parseGraphemes, patternOf, SPLIT_DIGRAPHS } from './phonics';

const g = (x: string) => `en:G:${x}`;
const P_CVC = 'en:P:cvc';
const P_BLEND = 'en:P:blend';
const t = (x: string) => `en:T:${x}`;

function buildSkills(): Record<string, Skill> {
  const skills: Record<string, Skill> = {};
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  for (const l of letters) {
    skills[g(l)] = { id: g(l), lang: 'en', kind: 'grapheme', display: l, label: `Letter ${l.toUpperCase()}${l}`, example: KEYWORDS[l] };
  }
  for (const m of MULTI_GRAPHEMES) {
    skills[g(m)] = { id: g(m), lang: 'en', kind: isVowelGrapheme(m) ? 'vowel' : 'grapheme', display: m, label: `Sound "${m}"`, example: KEYWORDS[m] };
  }
  for (const sd of SPLIT_DIGRAPHS) {
    skills[g(sd)] = { id: g(sd), lang: 'en', kind: 'vowel', display: sd.replace('_', '–'), label: `Magic e (${sd.replace('_', '–')})`, example: KEYWORDS[sd] };
  }
  skills[P_CVC] = { id: P_CVC, lang: 'en', kind: 'pattern', display: 'c-a-t', label: 'Blending sounds into words' };
  skills[P_BLEND] = { id: P_BLEND, lang: 'en', kind: 'pattern', display: 'fr-o-g', label: 'Consonant blends' };
  for (const w of TRICKY) {
    const disp = w === 'i' ? 'I' : w;
    skills[t(w)] = { id: t(w), lang: 'en', kind: 'tricky', display: disp, label: `Tricky word "${disp}"` };
  }
  return skills;
}

export function wordSkills(word: string): { graphemes: string[]; skills: string[]; pattern: string; difficulty: number } {
  const graphemes = parseGraphemes(word);
  const skills = new Set(graphemes.map(g));
  if (graphemes.length >= 2) skills.add(P_CVC);
  const blend = hasBlend(graphemes);
  if (blend) skills.add(P_BLEND);
  const pattern = patternOf(graphemes);
  const digraph = graphemes.some((x) => x.length === 2 && !isVowelGrapheme(x));
  const split = graphemes.some((x) => SPLIT_DIGRAPHS.includes(x));
  const team = graphemes.some((x) => x.length === 2 && isVowelGrapheme(x));
  const difficulty = 2.5 + 0.5 * graphemes.length + (digraph ? 0.5 : 0) + (blend ? 1 : 0) + (split ? 1.2 : 0) + (team ? 1.2 : 0);
  return { graphemes, skills: [...skills], pattern, difficulty: Math.round(difficulty * 10) / 10 };
}

function sentenceTokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z' ]/g, ' ').split(/\s+/).filter(Boolean);
}

function buildItems(): LearningItem[] {
  const items: LearningItem[] = [];
  // Letters, both cases.
  for (const [l, names] of Object.entries(LETTER_NAMES)) {
    for (const disp of [l, l.toUpperCase()]) {
      items.push({
        id: `en:letter:${disp}`, lang: 'en', kind: 'letter', display: disp, accepted: names,
        parts: [disp], skills: [g(l)], difficulty: disp === l ? 1 : 1.2, isRealWord: false,
        speakAs: l, strict: true,
      });
    }
  }
  // Sound chunks.
  for (const c of CHUNKS) {
    const graphemes = parseGraphemes(c.text);
    items.push({
      id: `en:syl:${c.text}`, lang: 'en', kind: 'syllable', display: c.text, accepted: c.accepted,
      parts: graphemes.length > 1 && !MULTI_GRAPHEMES.includes(c.text) ? graphemes : [c.text],
      skills: graphemes.map(g), difficulty: 2, isRealWord: false, speakAs: c.text, strict: true,
      pattern: patternOf(graphemes),
    });
  }
  // Words.
  for (const w of new Set(WORDS)) {
    const { graphemes, skills, pattern, difficulty } = wordSkills(w);
    items.push({
      id: `en:word:${w}`, lang: 'en', kind: 'word', display: w, accepted: [w], parts: graphemes,
      skills, difficulty, pattern, isRealWord: true, speakAs: w, strict: difficulty < 4.5,
    });
  }
  // Sentences.
  for (const s of SENTENCES) {
    const tokens = sentenceTokens(s);
    const skills = new Set<string>();
    for (const tok of tokens) {
      if (TRICKY.includes(tok)) skills.add(t(tok));
      else wordSkills(tok).skills.forEach((x) => skills.add(x));
    }
    items.push({
      id: `en:sent:${tokens.join('-')}`, lang: 'en', kind: 'sentence', display: s, accepted: [s],
      parts: s.replace(/[.!?]/g, '').split(/\s+/), skills: [...skills],
      difficulty: Math.round((7 + tokens.length * 0.4) * 10) / 10, isRealWord: true, speakAs: s, strict: false,
    });
  }
  return items;
}

const letters = (s: string) => s.split('').map(g);

/**
 * Units 1–2 (the first four levels) are pure letters, exactly as the game
 * first shipped. From unit 3 on, syllables and then words arrive much sooner
 * than a letters-first course would allow: sound chunks and the first CVC
 * words in unit 3, all CVC words by unit 4, digraphs folded into unit 5.
 * A fluent reader gets the next unit's exercises even earlier (unitView).
 */
const UNITS: Unit[] = [
  { id: 'en-1', stage: 1, newSkills: letters('satp'), kinds: { letter: 1 }, maxDifficulty: 1.2, title: { en: 'First Sounds: s a t p', he: 'צלילים ראשונים' } },
  { id: 'en-2', stage: 1, newSkills: letters('indm'), kinds: { letter: 1 }, maxDifficulty: 1.2, title: { en: 'More Sounds: i n m d', he: 'עוד צלילים' } },
  { id: 'en-3', stage: 2, newSkills: [...letters('gocke'), P_CVC], kinds: { letter: 0.5, syllable: 0.7, word: 0.6 }, maxDifficulty: 4, title: { en: 'Sound Chunks & First Words', he: 'צירופי צלילים ומילים ראשונות' } },
  { id: 'en-4', stage: 2, newSkills: letters('urhbfl'), kinds: { word: 1, syllable: 0.3, letter: 0.25 }, maxDifficulty: 4.5, title: { en: 'Short Words: u r h b f l', he: 'מילים קצרות' } },
  { id: 'en-5', stage: 3, newSkills: [...letters('jvwxyzq'), g('sh'), g('ch'), g('th')], kinds: { word: 1, syllable: 0.4, letter: 0.15 }, maxDifficulty: 4.8, title: { en: 'Buddy Letters: sh ch th', he: 'אותיות חברות' } },
  { id: 'en-6', stage: 3, newSkills: [], transfer: true, kinds: { word: 1 }, maxDifficulty: 5, title: { en: 'Explorer: New Words', he: 'מגלי מילים' } },
  { id: 'en-7', stage: 4, newSkills: [g('ck'), g('ng'), g('ll'), g('ss'), g('ff'), g('zz'), g('qu'), g('wh')], focus: [g('sh'), g('ch'), g('th')], kinds: { word: 1 }, maxDifficulty: 5.4, title: { en: 'Digraph Words', he: 'מילים עם צמדים' } },
  { id: 'en-8', stage: 4, newSkills: [P_BLEND], kinds: { word: 1 }, maxDifficulty: 6.6, title: { en: 'Blends: fr- st- -mp', he: 'צרורות' } },
  { id: 'en-9', stage: 5, newSkills: SPLIT_DIGRAPHS.map(g), kinds: { word: 1 }, maxDifficulty: 6.8, title: { en: 'Magic E', he: 'E הקסם' } },
  { id: 'en-10', stage: 5, newSkills: ['ee', 'oo', 'ai', 'oa', 'ar', 'or', 'ay'].map(g), kinds: { word: 1 }, maxDifficulty: 7.2, title: { en: 'Vowel Teams', he: 'צוותי תנועות' } },
  { id: 'en-11', stage: 5, newSkills: [], transfer: true, kinds: { word: 1 }, maxDifficulty: 7.2, title: { en: 'Explorer: Big Words', he: 'מגלי מילים גדולות' } },
  { id: 'en-12', stage: 6, newSkills: ['the', 'is', 'a', 'i', 'we', 'he', 'she', 'my', 'has'].map(t), kinds: { sentence: 0.35, word: 1 }, maxDifficulty: 10, title: { en: 'First Sentences', he: 'משפטים ראשונים' } },
  { id: 'en-13', stage: 6, newSkills: ['to', 'was', 'you', 'are', 'of', 'be', 'me', 'go', 'no', 'so'].map(t), kinds: { sentence: 0.6, word: 1 }, maxDifficulty: 10, title: { en: 'Story Time', he: 'זמן סיפור' } },
];

export function buildEnglishPack(): LanguagePack {
  return { lang: 'en', dir: 'ltr', speechLang: 'en-US', skills: buildSkills(), units: UNITS, items: buildItems(), bossFreeSkills: [P_CVC] };
}
