import { recentAccuracy, recentTransfer, type LearnerState } from './learner';

export type DifficultyMode = 'ease' | 'normal' | 'challenge';

export interface DifficultyProfile {
  mode: DifficultyMode;
  /** Multiplies how long enemies take to walk the path (>1 = slower). */
  durationFactor: number;
  /** Added to the level's enemy count. */
  enemyDelta: number;
  /** Max simultaneous enemies on the path. */
  maxAlive: number;
  /** Shift to the unit's difficulty ceiling. */
  difficultyShift: number;
  /** Target share of never-seen items in a level. */
  novelShare: number;
  /** Use fast enemies for familiar words. */
  fastEnemies: boolean;
}

export const PROFILES: Record<DifficultyMode, DifficultyProfile> = {
  ease: { mode: 'ease', durationFactor: 1.3, enemyDelta: -2, maxAlive: 2, difficultyShift: -0.8, novelShare: 0.15, fastEnemies: false },
  normal: { mode: 'normal', durationFactor: 1, enemyDelta: 0, maxAlive: 3, difficultyShift: 0, novelShare: 0.3, fastEnemies: true },
  challenge: { mode: 'challenge', durationFactor: 0.9, enemyDelta: 2, maxAlive: 3, difficultyShift: 0.6, novelShare: 0.45, fastEnemies: true },
};

/**
 * Pick the difficulty for the next level from demonstrated reading.
 *
 * - Struggling (low first-try accuracy) eases off immediately.
 * - Challenge needs BOTH high accuracy AND success on never-seen items:
 *   repeating familiar words correctly never raises the difficulty, because
 *   familiar items carry little weight in recentAccuracy and none in
 *   recentTransfer.
 * - A manual setting can cap it (parents may prefer "gentle").
 */
export function chooseDifficulty(state: LearnerState, cap?: DifficultyMode): DifficultyProfile {
  const acc = recentAccuracy(state);
  const transfer = recentTransfer(state);
  let mode: DifficultyMode = 'normal';
  if (acc !== undefined && acc < 0.55) mode = 'ease';
  else if (acc !== undefined && acc >= 0.85 && transfer !== undefined && transfer >= 0.7) mode = 'challenge';
  if (cap === 'ease') mode = 'ease';
  if (cap === 'normal' && mode === 'challenge') mode = 'normal';
  return PROFILES[mode];
}

/** The scaffold to offer after a given number of wrong readings of one item. */
export interface Scaffold {
  /** Show the item split into its sounds / syllables. */
  breakdown: boolean;
  /** Highlight the part that went wrong. */
  highlight: boolean;
  /** Offer the "listen" button with an example pronunciation. */
  listen: boolean;
  /** Freeze the enemy so there is no time pressure at all. */
  freeze: boolean;
}

export function scaffoldFor(wrongAttempts: number): Scaffold {
  return {
    highlight: wrongAttempts >= 1,
    breakdown: wrongAttempts >= 1,
    listen: wrongAttempts >= 2,
    freeze: wrongAttempts >= 3,
  };
}
