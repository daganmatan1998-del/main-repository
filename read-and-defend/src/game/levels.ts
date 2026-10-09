import type { LanguageCode, LanguagePack } from '../content/types';

/**
 * Levels are generated from the curriculum: every unit has two levels — a
 * practice level and a guarded level that ends with a boss. A level never
 * owns a word list; it owns a unit (learning objectives), and the selector
 * draws fresh items for every attempt.
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

export function buildLevels(pack: LanguagePack): LevelDef[] {
  const levels: LevelDef[] = [];
  pack.units.forEach((u, unitIndex) => {
    for (const boss of [false, true]) {
      const n = levels.length + 1;
      const base = u.stage <= 2 ? 6 : u.stage <= 4 ? 7 : 8;
      levels.push({
        id: `${u.id}${boss ? 'b' : 'a'}`,
        lang: pack.lang,
        unitIndex,
        number: n,
        boss,
        enemyCount: base + (boss ? 1 : 0),
        environment: STAGE_ENVIRONMENT[u.stage],
        stage: u.stage,
      });
    }
  });
  return levels;
}

export const PRACTICE_LEVEL_ID = 'practice';
