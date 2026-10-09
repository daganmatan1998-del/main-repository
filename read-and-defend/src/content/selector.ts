import type { Rng } from '../core/rng';
import { shuffle, weightedPick } from '../core/rng';
import type { DifficultyProfile } from '../learning/adaptive';
import { isNovel, type LearnerState } from '../learning/learner';
import { knownSkills } from './registry';
import type { LanguagePack, LearningItem } from './types';

/**
 * Chooses the items for one attempt at a level.
 *
 * Items are drawn from the whole validated bank by SKILL, never from a fixed
 * per-level word list: any item whose required skills the child has been
 * taught is eligible. The mix is deliberate:
 *
 *  - focus:  items exercising the unit's new skills (what this level teaches)
 *  - novel:  items the child has never seen (tests transfer, not memory)
 *  - review: items weighted toward the child's weakest known skills
 *
 * A retry passes the previous attempt(s), whose items are penalised, so the
 * same objectives come back with a different selection and order.
 */

export interface SelectOptions {
  count: number;
  rng: Rng;
  profile: DifficultyProfile;
  /** Item ids used in previous attempts at this level, most recent first. */
  previous?: string[][];
  /** Reserve a boss slot (returned separately). */
  boss?: boolean;
}

export interface Selection {
  items: LearningItem[];
  /** One sentence, or for early stages a short chain of items. */
  boss: LearningItem[];
  focusSkills: string[];
}

function unitFocus(pack: LanguagePack, unitIndex: number, known: Set<string>): string[] {
  const unit = pack.units[unitIndex];
  if (unit.newSkills.length) return [...unit.newSkills, ...(unit.focus ?? [])];
  if (unit.focus?.length) return unit.focus;
  return [...known];
}

export function eligibleItems(pack: LanguagePack, unitIndex: number, profile?: DifficultyProfile): LearningItem[] {
  const unit = pack.units[unitIndex];
  const known = knownSkills(pack, unitIndex);
  const ceiling = unit.maxDifficulty + (profile?.difficultyShift ?? 0);
  return pack.items.filter((it) => {
    if (!(unit.kinds[it.kind] && unit.kinds[it.kind]! > 0)) return false;
    if (!it.skills.every((s) => known.has(s))) return false;
    // Keep at least the unit's own kinds available when easing.
    return it.difficulty <= Math.max(ceiling, minDifficultyOf(pack, unitIndex));
  });
}

function minDifficultyOf(pack: LanguagePack, unitIndex: number): number {
  const unit = pack.units[unitIndex];
  const known = knownSkills(pack, unitIndex);
  let min = Infinity;
  for (const it of pack.items) {
    if (unit.kinds[it.kind] && it.skills.every((s) => known.has(s))) min = Math.min(min, it.difficulty);
  }
  return min === Infinity ? 0 : min;
}

function weaknessOf(learner: LearnerState, item: LearningItem): number {
  let sum = 0, n = 0;
  for (const k of item.skills) {
    const s = learner.skills[k];
    if (s) { sum += 1 - s.score; n++; }
  }
  return n ? sum / n : 0.5;
}

export function selectLevelItems(pack: LanguagePack, unitIndex: number, learner: LearnerState, opts: SelectOptions): Selection {
  const { rng, profile } = opts;
  const unit = pack.units[unitIndex];
  const known = knownSkills(pack, unitIndex);
  const focusSkills = unitFocus(pack, unitIndex, known);
  const focusSet = new Set(focusSkills);
  const prevSets = (opts.previous ?? []).map((ids) => new Set(ids));
  const lastAttempt = prevSets[0] ?? new Set<string>();

  const all = eligibleItems(pack, unitIndex, profile);
  const regular = all.filter((it) => it.kind !== 'sentence');
  const sentences = all.filter((it) => it.kind === 'sentence');

  const hasFocus = (it: LearningItem) => it.skills.some((s) => focusSet.has(s));
  const score = (it: LearningItem): number => {
    let w = 1;
    if (hasFocus(it)) w += 2;
    if (isNovel(learner, it.id)) w += unit.transfer ? 3 : 1.5;
    w += 2 * weaknessOf(learner, it);
    if (lastAttempt.has(it.id)) w *= 0.15;
    else if (prevSets.some((s) => s.has(it.id))) w *= 0.5;
    const seen = learner.items[it.id];
    if (seen && seen.firstTry >= 3) w *= 0.35; // well known: little to learn
    if (unit.reducedNiqqud && it.niqqud === false) w *= 3;
    w *= unit.kinds[it.kind] ?? 0;
    return w * (0.75 + rng() * 0.5);
  };

  const chosen: LearningItem[] = [];
  const taken = new Set<string>();
  const shownText = new Set<string>();
  const take = (pool: LearningItem[], n: number) => {
    for (let i = 0; i < n; i++) {
      const cands = pool.filter((it) => !taken.has(it.id) && !shownText.has(it.display));
      const pick = weightedPick(cands.map((it) => ({ value: it, weight: score(it) })), rng);
      if (!pick) return;
      chosen.push(pick);
      taken.add(pick.id);
      shownText.add(pick.display);
    }
  };

  const count = Math.max(3, opts.count);
  const focusPool = regular.filter(hasFocus);
  const novelPool = regular.filter((it) => isNovel(learner, it.id));
  take(focusPool, Math.ceil(count * (unit.transfer ? 0.25 : 0.45)));
  take(novelPool, Math.round(count * (unit.transfer ? Math.max(0.5, profile.novelShare) : profile.novelShare)));
  take(regular, count - chosen.length);
  // Small banks (the first letters) cannot fill a level without repeats.
  // Repeating a letter is real practice; just never twice in a row.
  for (let guard = 0; chosen.length < count && regular.length > 1 && guard < 50; guard++) {
    const last = chosen[chosen.length - 1];
    const pick = weightedPick(regular.filter((it) => it !== last).map((it) => ({ value: it, weight: score(it) + 0.05 })), rng);
    if (pick) chosen.push(pick);
  }

  // Order: gentle ramp by difficulty with randomness, never the previous order.
  let ordered = chosen
    .map((it) => ({ it, key: it.difficulty + rng() * 1.5 }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.it);
  const prevOrder = opts.previous?.[0];
  if (prevOrder && ordered.length > 1 && ordered.every((it, i) => prevOrder[i] === it.id)) {
    ordered = shuffle(ordered, rng);
  }

  let boss: LearningItem[] = [];
  if (opts.boss) {
    const sentencePool = sentences.filter((s) => !lastAttempt.has(s.id));
    if (sentencePool.length) {
      const pick = weightedPick(sentencePool.map((it) => ({ value: it, weight: score(it) + 0.1 })), rng);
      if (pick) boss = [pick];
    } else {
      // Before sentences are taught, the boss is a chain of three readings,
      // hardest available, none repeated from the regular enemies.
      const pool = regular
        .filter((it) => !taken.has(it.id))
        .sort((a, b) => b.difficulty - a.difficulty)
        .slice(0, 12);
      boss = shuffle(pool, rng).slice(0, 3);
    }
  }

  return { items: ordered, boss, focusSkills };
}
