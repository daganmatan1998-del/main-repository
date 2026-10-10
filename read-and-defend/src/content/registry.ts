import type { LanguageCode, LanguagePack } from './types';
import { buildEnglishPack } from './english/pack';
import { buildHebrewPack } from './hebrew/pack';

/**
 * Language packs are built lazily and cached. Adding a language means writing
 * a builder that returns a LanguagePack and registering it here — the engine,
 * selector, learner model and level system are language-agnostic.
 */
const builders: Record<LanguageCode, () => LanguagePack> = {
  en: buildEnglishPack,
  he: buildHebrewPack,
};

const cache = new Map<LanguageCode, LanguagePack>();

export function getPack(lang: LanguageCode): LanguagePack {
  let p = cache.get(lang);
  if (!p) {
    p = builders[lang]();
    cache.set(lang, p);
  }
  return p;
}

export const LANGUAGES: LanguageCode[] = ['en', 'he'];

/** Skills known once the child has reached the given unit (inclusive). */
export function knownSkills(pack: LanguagePack, unitIndex: number): Set<string> {
  const s = new Set<string>();
  pack.units.slice(0, unitIndex + 1).forEach((u) => u.newSkills.forEach((k) => s.add(k)));
  return s;
}
