import type { LanguageCode, LanguagePack, LearningItem } from '../content/types';
import { isMastered, transferRate } from '../learning/learner';
import type { DailyState, LangProgress, Profile } from './profile';

/**
 * Rewards follow learning, not time: coins and XP come from readings, extra
 * for first-try reads and for words never seen before; achievements mark
 * learning milestones. No streaks, no random loot, no purchases.
 */

export function coinsForReading(firstTry: boolean, novel: boolean): number {
  return 1 + (firstTry ? 1 : 0) + (novel ? 2 : 0);
}

export function xpForReading(firstTry: boolean, novel: boolean, newlyMastered: number): number {
  return 5 + (firstTry ? 5 : 0) + (novel ? 10 : 0) + newlyMastered * 50;
}

export interface Achievement {
  id: string;
  title: { en: string; he: string };
  icon: 'star' | 'book' | 'compass' | 'scroll' | 'crown' | 'shield' | 'spark';
  check: (lp: LangProgress, pack: LanguagePack) => boolean;
}

const masteredCount = (lp: LangProgress, pack: LanguagePack, kinds: string[]) =>
  lp.learner.mastered.filter((k) => pack.skills[k] && kinds.includes(pack.skills[k].kind) && isMastered(lp.learner, k)).length;

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-read', icon: 'spark', title: { en: 'Your first reading!', he: 'קְרִיאָה רִאשׁוֹנָה!' }, check: (lp) => lp.stats.readings >= 1 },
  { id: 'five-sounds', icon: 'star', title: { en: 'You learned five new letter sounds!', he: 'חָמֵשׁ אוֹתִיּוֹת חֲדָשׁוֹת נִלְמְדוּ!' }, check: (lp, p) => masteredCount(lp, p, ['grapheme']) >= 5 },
  { id: 'all-vowels', icon: 'crown', title: { en: 'You can read every short vowel!', he: 'כָּל הַתְּנוּעוֹת נִלְמְדוּ!' }, check: (lp, p) => masteredCount(lp, p, ['vowel']) >= 5 },
  { id: 'ten-words', icon: 'book', title: { en: 'You read ten new words correctly!', he: 'עֶשֶׂר מִלִּים חֲדָשׁוֹת נִקְרְאוּ!' }, check: (lp) => lp.stats.newItemsRead >= 10 && lp.stats.wordsRead >= 10 },
  { id: 'transfer', icon: 'compass', title: { en: 'You can now read words you have never seen before!', he: 'מִלִּים שֶׁלֹּא נִרְאוּ אַף פַּעַם — וְהֵן נִקְרְאוּ!' }, check: (lp) => (transferRate(lp.learner) ?? 0) >= 0.7 && lp.learner.transfer.attempts >= 8 && lp.stats.wordsRead >= 8 },
  { id: 'fifty-words', icon: 'book', title: { en: 'Fifty different words read!', he: 'חֲמִשִּׁים מִלִּים שׁוֹנוֹת!' }, check: (lp) => lp.stats.newItemsRead >= 50 && lp.stats.wordsRead >= 50 },
  { id: 'first-sentence', icon: 'scroll', title: { en: 'You read a whole sentence!', he: 'מִשְׁפָּט שָׁלֵם נִקְרָא!' }, check: (lp) => lp.stats.sentencesRead >= 1 },
  { id: 'defender', icon: 'shield', title: { en: 'Castle defender: five levels won', he: 'שׁוֹמֵר הַטִּירָה: חֲמִשָּׁה שְׁלַבִּים' }, check: (lp) => lp.stats.levelsWon >= 5 },
];

/** Returns achievements newly earned (and records them on the profile). */
export function checkAchievements(profile: Profile, lang: LanguageCode, pack: LanguagePack): Achievement[] {
  const lp = profile.langs[lang];
  const earned: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    const key = `${lang}:${a.id}`;
    if (profile.achievements[key]) continue;
    if (a.check(lp, pack)) {
      profile.achievements[key] = Date.now();
      earned.push(a);
    }
  }
  return earned;
}

/* ---------------------------------------------------------------- shop */

export interface ShopItem {
  id: string;
  slot: 'banner' | 'walls' | 'magic';
  price: number;
  color: string;
  name: { en: string; he: string };
}

export const SHOP: ShopItem[] = [
  { id: 'banner-red', slot: 'banner', price: 0, color: '#e63946', name: { en: 'Red banner', he: 'דֶּגֶל אָדֹם' } },
  { id: 'banner-blue', slot: 'banner', price: 30, color: '#3a86ff', name: { en: 'Blue banner', he: 'דֶּגֶל כָּחֹל' } },
  { id: 'banner-green', slot: 'banner', price: 30, color: '#2a9d8f', name: { en: 'Green banner', he: 'דֶּגֶל יָרֹק' } },
  { id: 'banner-purple', slot: 'banner', price: 60, color: '#8338ec', name: { en: 'Royal banner', he: 'דֶּגֶל מַלְכוּתִי' } },
  { id: 'walls-stone', slot: 'walls', price: 0, color: '#b8b2a7', name: { en: 'Stone walls', he: 'חוֹמַת אֶבֶן' } },
  { id: 'walls-sand', slot: 'walls', price: 50, color: '#e9c46a', name: { en: 'Sandstone walls', he: 'חוֹמַת חוֹל' } },
  { id: 'walls-marble', slot: 'walls', price: 120, color: '#eef1f6', name: { en: 'Marble walls', he: 'חוֹמַת שַׁיִשׁ' } },
  { id: 'walls-crystal', slot: 'walls', price: 200, color: '#9bf6ff', name: { en: 'Crystal walls', he: 'חוֹמַת בְּדֹלַח' } },
  { id: 'magic-gold', slot: 'magic', price: 0, color: '#ffd166', name: { en: 'Golden spark', he: 'נִיצוֹץ זָהָב' } },
  { id: 'magic-rainbow', slot: 'magic', price: 80, color: 'rainbow', name: { en: 'Rainbow spark', he: 'נִיצוֹץ קֶשֶׁת' } },
  { id: 'magic-frost', slot: 'magic', price: 60, color: '#a0e7ff', name: { en: 'Frost spark', he: 'נִיצוֹץ קֶרַח' } },
];

export function buy(profile: Profile, id: string): boolean {
  const item = SHOP.find((s) => s.id === id);
  if (!item || profile.owned.includes(id) || profile.coins < item.price) return false;
  profile.coins -= item.price;
  profile.owned.push(id);
  profile.equipped[item.slot] = id;
  return true;
}

export function equip(profile: Profile, id: string): boolean {
  const item = SHOP.find((s) => s.id === id);
  if (!item || !profile.owned.includes(id)) return false;
  profile.equipped[item.slot] = id;
  return true;
}

export const shopColor = (id: string) => SHOP.find((s) => s.id === id)?.color ?? '#ffd166';

/* --------------------------------------------------------------- daily */

export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * One optional challenge a day. Missing a day costs nothing — there is no
 * streak to lose.
 */
export function ensureDaily(lp: LangProgress, now = new Date()): DailyState {
  const date = todayKey(now);
  if (lp.daily && lp.daily.date === date) return lp.daily;
  const goals: DailyState['goal'][] = ['newWords', 'firstTry', 'sentences'];
  const canSentences = lp.stats.sentencesRead > 0;
  const pool = canSentences ? goals : goals.slice(0, 2);
  const goal = pool[now.getDate() % pool.length];
  lp.daily = { date, goal, target: goal === 'sentences' ? 2 : goal === 'newWords' ? 5 : 8, progress: 0, claimed: false };
  return lp.daily;
}

export function advanceDaily(lp: LangProgress, item: LearningItem, firstTry: boolean, novel: boolean): void {
  const d = lp.daily;
  if (!d || d.claimed) return;
  if (d.goal === 'newWords' && novel && item.kind !== 'letter') d.progress++;
  if (d.goal === 'firstTry' && firstTry) d.progress++;
  if (d.goal === 'sentences' && item.kind === 'sentence') d.progress++;
}

export const DAILY_REWARD = 15;
