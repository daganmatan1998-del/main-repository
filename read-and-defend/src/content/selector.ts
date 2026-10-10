import type { Rng } from '../core/rng';
import { weightedPick } from '../core/rng';
import type { DifficultyProfile } from '../learning/adaptive';
import { isFluent, isNovel, recentAccuracy, recentTransfer, type LearnerState } from '../learning/learner';
import { knownSkills } from './registry';
import type { ItemKind, LanguagePack, LearningItem } from './types';

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
 *
 * Progression follows ability, not just level count: once a child is fluent
 * in a unit's skills, the *next* unit's kinds of exercise (letters → short
 * words, short → longer words) start to appear a unit early (see unitView).
 */

export interface SelectOptions {
  count: number;
  rng: Rng;
  profile: DifficultyProfile;
  /** Item ids used in previous attempts at this level, most recent first. */
  previous?: string[][];
  /** Also choose the boss's three words. */
  boss?: boolean;
}

export interface Selection {
  items: LearningItem[];
  /** The boss's words, easiest first. Exactly three when requested. */
  boss: LearningItem[];
  /** The boss words use skills not yet taught: show them with a sound breakdown. */
  bossAssist: boolean;
  focusSkills: string[];
}

export const BOSS_WORDS = 3;

/* ------------------------------------------------------------ unit view */

export interface UnitView {
  known: Set<string>;
  kinds: Partial<Record<ItemKind, number>>;
  ceiling: number;
  /** The learner is ahead: the next unit's exercise kinds are mixed in. */
  ahead: boolean;
}

/** Fluent in everything this unit teaches, and reading accurately lately. */
export function unitReady(pack: LanguagePack, unitIndex: number, learner: LearnerState): boolean {
  const unit = pack.units[unitIndex];
  const core = unit.newSkills.filter((k) => pack.skills[k] && pack.skills[k].kind !== 'pattern');
  const acc = recentAccuracy(learner);
  if (acc === undefined || acc < 0.8) return false;
  if (!core.length) return (recentTransfer(learner) ?? 0) >= 0.7; // explorer units: success on new words
  // Two different items per sound — or as many as this unit actually offers
  // for it (a Hebrew letter has one item, an English one has a and A).
  const known = knownSkills(pack, unitIndex);
  const offered = (k: string) => pack.items.filter((it) => unit.kinds[it.kind] && it.skills.includes(k) && it.skills.every((x) => known.has(x))).length;
  return core.every((k) => isFluent(learner, k, Math.max(1, Math.min(2, offered(k)))));
}

/**
 * What a unit offers *to this learner*. A new learner (or one who is still
 * struggling) sees exactly the unit as authored. A fluent one also gets the
 * next unit's exercise kinds, and the next unit's procedural skills
 * (blending, silent letters), but never its letters or vowels: whatever is
 * shown can still be decoded from taught sounds.
 */
export function unitView(pack: LanguagePack, unitIndex: number, learner?: LearnerState): UnitView {
  const unit = pack.units[unitIndex];
  const known = knownSkills(pack, unitIndex);
  const kinds: UnitView['kinds'] = { ...unit.kinds };
  let ceiling = unit.maxDifficulty;
  let ahead = false;
  const next = pack.units[unitIndex + 1];
  if (learner && next && unitReady(pack, unitIndex, learner)) {
    ahead = true;
    for (const [k, w] of Object.entries(next.kinds) as Array<[ItemKind, number]>) kinds[k] = Math.max(kinds[k] ?? 0, w * 0.6);
    next.newSkills.filter((k) => pack.skills[k]?.kind === 'pattern' && k !== 'he:P:plain').forEach((k) => known.add(k));
    ceiling = Math.max(ceiling, next.maxDifficulty);
  }
  return { known, kinds, ceiling, ahead };
}

function unitFocus(pack: LanguagePack, unitIndex: number, known: Set<string>): string[] {
  const unit = pack.units[unitIndex];
  if (unit.newSkills.length) return [...unit.newSkills, ...(unit.focus ?? [])];
  if (unit.focus?.length) return unit.focus;
  return [...known];
}

export function eligibleItems(pack: LanguagePack, unitIndex: number, profile?: DifficultyProfile, learner?: LearnerState): LearningItem[] {
  const view = unitView(pack, unitIndex, learner);
  const ceiling = view.ceiling + (profile?.difficultyShift ?? 0);
  const fits = (it: LearningItem) => !!view.kinds[it.kind] && it.skills.every((s) => view.known.has(s));
  let min = Infinity;
  for (const it of pack.items) if (fits(it)) min = Math.min(min, it.difficulty);
  // Keep at least the unit's easiest items available when easing.
  const cap = Math.max(ceiling, min === Infinity ? 0 : min);
  return pack.items.filter((it) => fits(it) && it.difficulty <= cap);
}

function weaknessOf(learner: LearnerState, item: LearningItem): number {
  let sum = 0, n = 0;
  for (const k of item.skills) {
    const s = learner.skills[k];
    if (s) { sum += 1 - s.score; n++; }
  }
  return n ? sum / n : 0.5;
}

/* ----------------------------------------------------------------- boss */

export interface BossChoice { items: LearningItem[]; assist: boolean }

/**
 * Three words for the boss, easiest first.
 *
 * Words are real, decodable from what the child has been taught (blending
 * excepted — see LanguagePack.bossFreeSkills), and picked by skill rather
 * than from a list: previously unseen words are preferred, words that
 * exercise this unit's new sounds and the child's weak sounds are preferred,
 * and the previous attempt's words are strongly avoided, so a retry fights
 * a boss with different words and the same objectives.
 *
 * If a unit teaches so little that fewer than MIN_POOL words are decodable
 * (the very first Hebrew levels: no vowel yet), the pool widens one untaught
 * skill at a time and the boss is flagged `assist`, so the game shows the
 * sound breakdown from the start instead of springing unknown sounds on the child.
 */
const MIN_POOL = 6;

export function selectBossWords(
  pack: LanguagePack, unitIndex: number, learner: LearnerState,
  opts: { rng: Rng; previous?: string[][]; taken?: Set<string> },
): BossChoice {
  const view = unitView(pack, unitIndex, learner);
  const free = new Set(pack.bossFreeSkills);
  const unknown = (it: LearningItem) => it.skills.filter((k) => !view.known.has(k) && !free.has(k)).length;
  // Letter-stage units have a tiny difficulty ceiling; a boss word is still a word.
  const ceiling = Math.max(view.ceiling, 4.5);
  const words = pack.items.filter((it) => it.kind === 'word' && it.isRealWord && it.niqqud !== false && it.difficulty <= ceiling);

  let tier = 0;
  let pool = words.filter((w) => unknown(w) <= tier);
  while (pool.length < MIN_POOL && tier < 3) { tier++; pool = words.filter((w) => unknown(w) <= tier); }
  if (opts.taken) pool = pool.filter((w) => !opts.taken!.has(w.id) && !opts.taken!.has(`d:${w.display}`));
  if (pool.length < BOSS_WORDS) pool = words.filter((w) => unknown(w) <= 3 && !opts.taken?.has(w.id));

  const focus = new Set(unitFocus(pack, unitIndex, view.known));
  const prev = (opts.previous ?? []).map((ids) => new Set(ids));
  const lo = Math.min(...pool.map((w) => w.difficulty));
  const hi = Math.max(...pool.map((w) => w.difficulty));
  const score = (w: LearningItem): number => {
    let x = 1;
    if (w.skills.some((k) => focus.has(k))) x += 1.5;
    if (isNovel(learner, w.id)) x += 1.5;
    x += 2 * weaknessOf(learner, w);
    x *= 0.6 + 0.8 * (hi > lo ? (w.difficulty - lo) / (hi - lo) : 0.5); // lean toward the harder end of what is taught
    if (prev[0]?.has(w.id)) x *= 0.1;
    else if (prev.some((s) => s.has(w.id))) x *= 0.5;
    const seen = learner.items[w.id];
    if (seen && seen.firstTry >= 3) x *= 0.4;
    return x * (0.75 + opts.rng() * 0.5);
  };

  const chosen: LearningItem[] = [];
  const shown = new Set<string>();
  for (let i = 0; i < BOSS_WORDS; i++) {
    const cands = pool.filter((w) => !chosen.includes(w) && !shown.has(w.display));
    const pick = weightedPick(cands.map((w) => ({ value: w, weight: score(w) })), opts.rng);
    if (!pick) break;
    chosen.push(pick);
    shown.add(pick.display);
  }
  chosen.sort((a, b) => a.difficulty - b.difficulty);
  return { items: chosen, assist: tier > 0 };
}

/* ---------------------------------------------------------------- level */

export function selectLevelItems(pack: LanguagePack, unitIndex: number, learner: LearnerState, opts: SelectOptions): Selection {
  const { rng, profile } = opts;
  const unit = pack.units[unitIndex];
  const view = unitView(pack, unitIndex, learner);
  const focusSkills = unitFocus(pack, unitIndex, view.known);
  const focusSet = new Set(focusSkills);
  const prevSets = (opts.previous ?? []).map((ids) => new Set(ids));
  const lastAttempt = prevSets[0] ?? new Set<string>();

  const all = eligibleItems(pack, unitIndex, profile, learner);
  const regular = all.filter((it) => it.kind !== 'sentence' || !!view.kinds.sentence);

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
    w *= view.kinds[it.kind] ?? 0;
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
    ordered = [...ordered].reverse();
  }

  let boss: LearningItem[] = [];
  let bossAssist = false;
  if (opts.boss) {
    // Words the child reads in this very level are not reused for the boss.
    const used = new Set<string>([...taken, ...ordered.map((i) => `d:${i.display}`)]);
    const b = selectBossWords(pack, unitIndex, learner, { rng, previous: opts.previous, taken: used });
    boss = b.items;
    bossAssist = b.assist;
  }

  return { items: ordered, boss, bossAssist, focusSkills };
}
