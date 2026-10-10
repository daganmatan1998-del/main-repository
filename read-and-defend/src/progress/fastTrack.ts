import type { LanguagePack } from '../content/types';
import { unitReady } from '../content/selector';
import { recentTransfer } from '../learning/learner';
import type { LevelDef } from '../game/levels';
import type { LangProgress } from './profile';

/**
 * Progress by demonstrated ability, not by counting levels: when a reader
 * three-stars the first level of a unit, is fluent in every sound the unit
 * teaches, and is reading words they had never seen on the first try, the
 * unit's second (practice) level is skipped.
 *
 * Never in the first two units (the first four levels stay exactly as the
 * game first shipped), and never for a level that was already played.
 */
export const FAST_TRACK_FIRST_UNIT = 2;

export function levelDone(lp: LangProgress, levelId: string): boolean {
  const r = lp.levels[levelId];
  return !!r && (r.wins > 0 || !!r.skipped);
}

export function fastTrackTarget(lp: LangProgress, pack: LanguagePack, levels: LevelDef[], won: LevelDef, stars: number): LevelDef | null {
  if (stars < 3 || won.unitIndex < FAST_TRACK_FIRST_UNIT) return null;
  const idx = levels.findIndex((l) => l.id === won.id);
  const next = levels[idx + 1];
  if (!next || next.unitIndex !== won.unitIndex || levelDone(lp, next.id)) return null;
  if (!unitReady(pack, won.unitIndex, lp.learner)) return null;
  const transfer = recentTransfer(lp.learner);
  if (transfer === undefined || transfer < 0.7) return null;
  return next;
}
