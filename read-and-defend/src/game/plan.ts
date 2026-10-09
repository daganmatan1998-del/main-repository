import type { LearningItem } from '../content/types';
import type { Selection } from '../content/selector';
import type { DifficultyProfile } from '../learning/adaptive';
import type { LearnerState } from '../learning/learner';
import type { EnemySpec, EnemyType } from './levelState';

/**
 * Enemy type follows the reading, so the visual variety always means
 * something:
 *   slime  — letters and short words (small, beginner)
 *   goblin — ordinary words
 *   knight — long or complex words and sentences (armoured, slower, hits harder)
 *   bat    — words this child already reads fluently (fast: tests fluency)
 *   boss   — only the final enemy of a level: three words, read one at a time
 */
export function enemyTypeFor(item: LearningItem, learner: LearnerState, profile: DifficultyProfile): EnemyType {
  if (item.kind === 'letter' || item.kind === 'syllable') return 'slime';
  // A sentence is long and slow to read: an armoured knight. Only the final three-word boss is a boss.
  if (item.kind === 'sentence') return 'knight';
  const stats = learner.items[item.id];
  if (profile.fastEnemies && stats && stats.firstTry >= 2) return 'bat';
  if (item.difficulty >= 5.2 || item.parts.length >= 4) return 'knight';
  // Short words ride on the small monsters, longer ones on goblins.
  if (item.difficulty <= 3.6) return 'slime';
  return 'goblin';
}

export function buildEnemyPlan(sel: Selection, learner: LearnerState, profile: DifficultyProfile): EnemySpec[] {
  const specs: EnemySpec[] = sel.items.map((it) => ({ type: enemyTypeFor(it, learner, profile), items: [it] }));
  if (sel.boss.length) specs.push({ type: 'boss', items: sel.boss, assist: sel.bossAssist });
  return specs;
}
