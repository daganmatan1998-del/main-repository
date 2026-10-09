import type { LearningItem } from '../content/types';
import type { Selection } from '../content/selector';
import type { DifficultyProfile } from '../learning/adaptive';
import type { LearnerState } from '../learning/learner';
import type { EnemySpec, EnemyType } from './levelState';

/**
 * Enemy type follows the reading, so the visual variety always means
 * something:
 *   slime  — letters and sound chunks (small, beginner)
 *   goblin — ordinary words
 *   knight — long or complex words (armoured, slower, hits harder)
 *   bat    — words this child already reads fluently (fast: tests fluency)
 *   boss   — a sentence, or a chain of readings before sentences are taught
 */
export function enemyTypeFor(item: LearningItem, learner: LearnerState, profile: DifficultyProfile): EnemyType {
  if (item.kind === 'letter' || item.kind === 'syllable') return 'slime';
  if (item.kind === 'sentence') return 'boss';
  const stats = learner.items[item.id];
  if (profile.fastEnemies && stats && stats.firstTry >= 2) return 'bat';
  if (item.difficulty >= 5.2 || item.parts.length >= 4) return 'knight';
  return 'goblin';
}

export function buildEnemyPlan(sel: Selection, learner: LearnerState, profile: DifficultyProfile): EnemySpec[] {
  const specs: EnemySpec[] = sel.items.map((it) => ({ type: enemyTypeFor(it, learner, profile), items: [it] }));
  if (sel.boss.length) specs.push({ type: 'boss', items: sel.boss });
  return specs;
}
