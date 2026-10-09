import type { LearningItem } from '../content/types';

/**
 * The learner model: what this child can actually decode.
 *
 * Evidence is weighted by novelty. Reading a word for the first time is
 * strong evidence the child decoded it; reading the same word for the tenth
 * time is weak evidence (it may simply be remembered). Mastery therefore
 * requires success across several different items, and the "transfer" score
 * counts only first encounters.
 */

export interface ItemStats {
  seen: number;
  attempts: number;
  solved: number;
  firstTry: number;
  lastSeen: number;
  /** Sum of reading times (ms) for first-try successes, and their count. */
  msTotal: number;
  msCount: number;
}

export interface SkillStats {
  attempts: number;
  solved: number;
  firstTry: number;
  /** Exponentially-weighted, novelty-weighted accuracy, 0..1. */
  score: number;
  /** Distinct items solved that exercise this skill (capped list). */
  solvedItems: string[];
  /** Times the child needed more than one try on an item with this skill. */
  struggles: number;
  lastPracticed: number;
}

export interface RecentResult {
  ok: boolean;
  firstTry: boolean;
  novel: boolean;
  /** Weight of this result as evidence (novel 1, familiar less). */
  w: number;
}

export interface LearnerState {
  version: 1;
  items: Record<string, ItemStats>;
  skills: Record<string, SkillStats>;
  transfer: { attempts: number; firstTry: number };
  recent: RecentResult[];
  /** Skill ids already celebrated as mastered. */
  mastered: string[];
}

export interface ReadingResult {
  item: LearningItem;
  /** Readings judged incorrect before success (uncertain ones never count). */
  wrongAttempts: number;
  /** false when the enemy reached the castle before the item was read. */
  solved: boolean;
  /** Time from the enemy becoming the target until success, if measured. */
  ms?: number;
  now?: number;
}

export interface RecordOutcome {
  novel: boolean;
  newlyMastered: string[];
}

const ALPHA = 0.35;
const RECENT_MAX = 30;
export const MASTERY_SCORE = 0.78;

export function createLearner(): LearnerState {
  return { version: 1, items: {}, skills: {}, transfer: { attempts: 0, firstTry: 0 }, recent: [], mastered: [] };
}

export function isNovel(state: LearnerState, itemId: string): boolean {
  return !state.items[itemId] || state.items[itemId].seen === 0;
}

/** Evidence weight: first encounter 1.0, falling with each prior success. */
export function evidenceWeight(state: LearnerState, itemId: string): number {
  const s = state.items[itemId];
  if (!s) return 1;
  return 1 / (1 + s.solved * 0.75);
}

export function recordResult(state: LearnerState, r: ReadingResult): RecordOutcome {
  const now = r.now ?? Date.now();
  const id = r.item.id;
  const novel = isNovel(state, id);
  const w = evidenceWeight(state, id);
  const firstTry = r.solved && r.wrongAttempts === 0;

  const it = (state.items[id] ??= { seen: 0, attempts: 0, solved: 0, firstTry: 0, lastSeen: 0, msTotal: 0, msCount: 0 });
  it.seen += 1;
  it.attempts += r.wrongAttempts + (r.solved ? 1 : 0);
  if (r.solved) it.solved += 1;
  if (firstTry) {
    it.firstTry += 1;
    if (r.ms !== undefined && r.ms > 0 && r.ms < 60000) { it.msTotal += r.ms; it.msCount += 1; }
  }
  it.lastSeen = now;

  // 1 = read first time, 0.55 = read after help, 0.1 = not read.
  const value = firstTry ? 1 : r.solved ? 0.55 : 0.1;
  for (const k of r.item.skills) {
    const s = (state.skills[k] ??= { attempts: 0, solved: 0, firstTry: 0, score: 0.5, solvedItems: [], struggles: 0, lastPracticed: 0 });
    s.attempts += 1;
    if (r.solved) s.solved += 1;
    if (firstTry) s.firstTry += 1;
    if (r.wrongAttempts > 0 || !r.solved) s.struggles += 1;
    s.score += ALPHA * w * (value - s.score);
    if (r.solved && !s.solvedItems.includes(id)) {
      s.solvedItems.push(id);
      if (s.solvedItems.length > 24) s.solvedItems.shift();
    }
    s.lastPracticed = now;
  }

  if (novel) {
    state.transfer.attempts += 1;
    if (firstTry) state.transfer.firstTry += 1;
  }
  state.recent.push({ ok: r.solved, firstTry, novel, w });
  if (state.recent.length > RECENT_MAX) state.recent.shift();

  const newlyMastered: string[] = [];
  for (const k of r.item.skills) {
    if (!state.mastered.includes(k) && isMastered(state, k)) {
      state.mastered.push(k);
      newlyMastered.push(k);
    }
  }
  return { novel, newlyMastered };
}

/** Mastered = consistently accurate across at least three different items. */
export function isMastered(state: LearnerState, skillId: string): boolean {
  const s = state.skills[skillId];
  return !!s && s.score >= MASTERY_SCORE && s.solvedItems.length >= 3;
}

export function skillScore(state: LearnerState, skillId: string): number | undefined {
  return state.skills[skillId]?.score;
}

/** Skills practised enough to judge, and currently weak. Weakest first. */
export function weakSkills(state: LearnerState, among?: Iterable<string>): string[] {
  const ids = among ? [...among] : Object.keys(state.skills);
  return ids
    .filter((k) => state.skills[k] && state.skills[k].attempts >= 2 && state.skills[k].score < 0.6)
    .sort((a, b) => state.skills[a].score - state.skills[b].score);
}

/** First-try accuracy over recent readings, with familiar items discounted. */
export function recentAccuracy(state: LearnerState, last = 12): number | undefined {
  const r = state.recent.slice(-last);
  if (r.length < 4) return undefined;
  const tw = r.reduce((s, x) => s + x.w, 0);
  return r.reduce((s, x) => s + (x.firstTry ? x.w : 0), 0) / tw;
}

/** First-try accuracy on words the child had never been shown. */
export function transferRate(state: LearnerState): number | undefined {
  const t = state.transfer;
  return t.attempts < 3 ? undefined : t.firstTry / t.attempts;
}

/** Recent transfer: of the recent novel items, how many were read first try. */
export function recentTransfer(state: LearnerState, last = 12): number | undefined {
  const r = state.recent.slice(-last).filter((x) => x.novel);
  if (r.length < 3) return undefined;
  return r.filter((x) => x.firstTry).length / r.length;
}

export function averageReadingMs(state: LearnerState): number | undefined {
  let t = 0, n = 0;
  for (const s of Object.values(state.items)) { t += s.msTotal; n += s.msCount; }
  return n ? t / n : undefined;
}
