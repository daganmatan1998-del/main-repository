/**
 * Educational content model.
 *
 * Skills (letter-sound relationships, vowel patterns, spelling patterns) are
 * kept separate from the items used to practise them. Every item lists the
 * skills it requires, so the selector can only ever show a child an item they
 * have been taught to decode — and can show them items they have never seen.
 */

export type LanguageCode = 'en' | 'he';

export type ItemKind = 'letter' | 'syllable' | 'word' | 'sentence';

export type SkillKind = 'grapheme' | 'vowel' | 'pattern' | 'tricky';

export interface Skill {
  id: string;
  lang: LanguageCode;
  kind: SkillKind;
  /** What the child sees when the skill is introduced, e.g. "sh" or "בּ". */
  display: string;
  /** Short label for parents / progress report. */
  label: string;
  /** A word that demonstrates the sound, used for hints ("s as in sun"). */
  example?: string;
}

export interface LearningItem {
  id: string;
  lang: LanguageCode;
  kind: ItemKind;
  /** Text displayed to the child. */
  display: string;
  /**
   * Acceptable spoken transcriptions, before normalisation. For Hebrew
   * syllables and words, additional spellings are derived by the evaluator.
   */
  accepted: string[];
  /** Units for the "sound it out" hint: graphemes or syllables. */
  parts: string[];
  /** Every skill required to decode this item. */
  skills: string[];
  /** 1 (single letter) … 10 (long sentence). */
  difficulty: number;
  /** Structural pattern, e.g. CVC, CCVC, CVCe, CV. */
  pattern?: string;
  /** Hebrew: display carries niqqud. */
  niqqud?: boolean;
  isRealWord: boolean;
  /** Text handed to speech synthesis for the "listen" example. */
  speakAs: string;
  /** Strict evaluation (phonics drills) vs. tolerant (words / sentences). */
  strict: boolean;
}

export type Stage = 1 | 2 | 3 | 4 | 5 | 6;

export interface Unit {
  id: string;
  stage: Stage;
  /** Skills introduced in this unit. Earlier units' skills are "known". */
  newSkills: string[];
  /** Item kinds practised in this unit, with relative weights. */
  kinds: Partial<Record<ItemKind, number>>;
  /** Max difficulty considered for this unit. */
  maxDifficulty: number;
  /** Skills to emphasise when the unit introduces nothing new. */
  focus?: string[];
  /** A transfer unit: favours words the child has never been shown. */
  transfer?: boolean;
  /** Hebrew stage 5+: show some words without niqqud. */
  reducedNiqqud?: boolean;
  title: { en: string; he: string };
}

export interface LanguagePack {
  lang: LanguageCode;
  dir: 'ltr' | 'rtl';
  /** BCP-47 tag for speech recognition and synthesis. */
  speechLang: string;
  skills: Record<string, Skill>;
  units: Unit[];
  /** The whole item bank: curated + rule-generated, all validated. */
  items: LearningItem[];
  /**
   * Skills that are procedure rather than letter knowledge (blending sounds
   * into a word). Boss words may assume them: the first level's boss can use
   * s-a-t-p words even though blending is formally taught later.
   */
  bossFreeSkills: string[];
}
