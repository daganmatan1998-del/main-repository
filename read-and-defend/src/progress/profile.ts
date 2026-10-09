import type { LanguageCode } from '../content/types';
import type { HebrewLetterMode } from '../evaluation/config';
import { createLearner, type LearnerState } from '../learning/learner';
import type { StorageAdapter } from '../persistence/storage';

export type Pace = 'slow' | 'normal' | 'fast';
export type MicMode = 'hold' | 'tap';
export type EngineChoice = 'auto' | 'browser' | 'server' | 'native';

export interface Settings {
  pace: Pace;
  micMode: MicMode;
  sound: boolean;
  /** Spoken instructions (speech synthesis). */
  voiceHints: boolean;
  engine: EngineChoice;
  /** Speech-to-text endpoint of the server proxy (no secrets in the app). */
  sttEndpoint: string;
  /** Development mode: simulated recognition, clearly labelled. */
  devMode: boolean;
  /** Caps adaptive difficulty: 'auto' lets the game decide. */
  difficultyCap: 'auto' | 'ease' | 'normal';
  reducedMotion: boolean;
  bigText: boolean;
  /** How forgiving Hebrew letter/syllable/word matching is (see evaluation/config.ts). */
  hebrewLetterMode: HebrewLetterMode;
}

export interface LevelRecord {
  /** Passed over because the reader showed mastery of the unit's skills. */
  skipped?: boolean;
  stars: number;
  bestScore: number;
  attempts: number;
  wins: number;
  /** Item ids per recent attempt, newest first (drives varied retries). */
  history: string[][];
}

export interface DailyState {
  date: string;
  goal: 'newWords' | 'firstTry' | 'sentences';
  target: number;
  progress: number;
  claimed: boolean;
}

export interface LangProgress {
  learner: LearnerState;
  levels: Record<string, LevelRecord>;
  tutorialDone: boolean;
  stats: { readings: number; newItemsRead: number; sentencesRead: number; wordsRead: number; levelsWon: number; simulatedReadings: number };
  daily: DailyState | null;
}

export interface Profile {
  version: 1;
  lang: LanguageCode | null;
  settings: Settings;
  coins: number;
  xp: number;
  owned: string[];
  equipped: { banner: string; walls: string; magic: string };
  achievements: Record<string, number>;
  langs: Record<LanguageCode, LangProgress>;
}

export const DEFAULT_SETTINGS: Settings = {
  pace: 'normal', micMode: 'hold', sound: true, voiceHints: true, engine: 'auto',
  sttEndpoint: '/api/stt', devMode: false, difficultyCap: 'auto', reducedMotion: false, bigText: false, hebrewLetterMode: 'normal',
};

export function newLangProgress(): LangProgress {
  return {
    learner: createLearner(), levels: {}, tutorialDone: false,
    stats: { readings: 0, newItemsRead: 0, sentencesRead: 0, wordsRead: 0, levelsWon: 0, simulatedReadings: 0 },
    daily: null,
  };
}

export function newProfile(): Profile {
  return {
    version: 1, lang: null, settings: { ...DEFAULT_SETTINGS }, coins: 0, xp: 0,
    owned: ['banner-red', 'walls-stone', 'magic-gold'],
    equipped: { banner: 'banner-red', walls: 'walls-stone', magic: 'magic-gold' },
    achievements: {}, langs: { en: newLangProgress(), he: newLangProgress() },
  };
}

const KEY = 'read-and-defend:profile:v1';

/** Load, repairing anything missing so older saves keep working. */
export function loadProfile(storage: StorageAdapter): Profile {
  let raw: string | null = null;
  try { raw = storage.get(KEY); } catch { /* unavailable */ }
  if (!raw) return newProfile();
  try {
    const p = JSON.parse(raw) as Partial<Profile>;
    const base = newProfile();
    return {
      ...base, ...p,
      settings: { ...base.settings, ...(p.settings ?? {}) },
      equipped: { ...base.equipped, ...(p.equipped ?? {}) },
      langs: {
        en: { ...newLangProgress(), ...(p.langs?.en ?? {}) },
        he: { ...newLangProgress(), ...(p.langs?.he ?? {}) },
      },
    } as Profile;
  } catch {
    return newProfile();
  }
}

export function saveProfile(storage: StorageAdapter, p: Profile): boolean {
  try { storage.set(KEY, JSON.stringify(p)); return true; } catch { return false; }
}

export function clearProfile(storage: StorageAdapter): void {
  try { storage.remove(KEY); } catch { /* ignore */ }
}

export function levelRecord(lp: LangProgress, levelId: string): LevelRecord {
  return (lp.levels[levelId] ??= { stars: 0, bestScore: 0, attempts: 0, wins: 0, history: [] });
}
