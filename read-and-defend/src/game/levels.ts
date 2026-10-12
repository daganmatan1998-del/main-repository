import type { LanguageCode, LanguagePack } from '../content/types';

/**
 * Levels are generated from the curriculum. Every unit has two regular
 * levels of ten monsters; the last level of every world is a boss fight.
 * A level never owns a word list; it owns a unit (learning objectives), and
 * the selector draws fresh items for every attempt.
 */

export type EnvironmentId = 'meadow' | 'forest' | 'canyon' | 'snow' | 'volcano' | 'sky';

export interface LevelDef {
  id: string;
  lang: LanguageCode;
  unitIndex: number;
  /** 1-based position in the world map. */
  number: number;
  boss: boolean;
  enemyCount: number;
  environment: EnvironmentId;
  stage: number;
}

export const STAGE_ENVIRONMENT: Record<number, EnvironmentId> = {
  1: 'meadow', 2: 'forest', 3: 'canyon', 4: 'snow', 5: 'volcano', 6: 'sky',
};

/** Monsters in every regular level. */
export const REGULAR_ENEMIES = 10;

/**
 * Two regular levels per unit; after the last unit of each world, that
 * world's boss. A fluent reader may skip a unit's second level (see
 * progress/fastTrack.ts) but never a boss.
 */
export function buildLevels(pack: LanguagePack): LevelDef[] {
  const levels: LevelDef[] = [];
  const add = (l: Omit<LevelDef, 'number' | 'lang'>) => levels.push({ ...l, lang: pack.lang, number: levels.length + 1 });
  pack.units.forEach((u, unitIndex) => {
    for (const second of [false, true]) {
      add({
        id: `${u.id}${second ? 'b' : 'a'}`, unitIndex, boss: false, enemyCount: REGULAR_ENEMIES,
        environment: STAGE_ENVIRONMENT[u.stage], stage: u.stage,
      });
    }
    const lastOfWorld = pack.units[unitIndex + 1]?.stage !== u.stage;
    if (lastOfWorld) {
      add({
        id: `${pack.lang}-boss-${u.stage}`, unitIndex, boss: true, enemyCount: 0,
        environment: STAGE_ENVIRONMENT[u.stage], stage: u.stage,
      });
    }
  });
  return levels;
}

export const PRACTICE_LEVEL_ID = 'practice';
