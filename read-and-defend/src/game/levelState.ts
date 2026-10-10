import type { LearningItem } from '../content/types';
import type { Evaluation } from '../evaluation/evaluator';

/**
 * Pure, deterministic level simulation: enemies, castle, win/lose. No DOM,
 * no timers, no randomness — the renderer and controller read the state and
 * drain `events`, and tests drive it with tick() and applyEvaluation().
 */

export type EnemyType = 'slime' | 'goblin' | 'bat' | 'knight' | 'boss';

export interface EnemySpec {
  type: EnemyType;
  /** Items to read in order; a boss needs three, one at a time. */
  items: LearningItem[];
  /** Show the sound breakdown from the start (words using sounds not yet taught). */
  assist?: boolean;
}

/** Monsters only slow down for speech on the first 80 % of the road. */
const LISTENING_SLOW_UNTIL = 0.8;

export type EnemyStatus = 'waiting' | 'walking' | 'defeated' | 'breached';

export interface Enemy {
  id: number;
  type: EnemyType;
  items: LearningItem[];
  phase: number;
  /** 0 at the spawn point, 1 at the castle gate. */
  progress: number;
  /** Seconds this enemy takes to walk the whole path at the default pace. */
  walkSeconds: number;
  status: EnemyStatus;
  assist: boolean;
  /** Wrong readings on the current phase. */
  wrong: number;
  /** Wrong readings across all phases (for stats). */
  wrongTotal: number;
  /** Seconds this enemy has been the reading target (current phase). */
  targetTime: number;
  /** Frozen enemies do not move (scaffold after repeated struggle). */
  frozen: boolean;
  spawnIndex: number;
}

export type LevelStatus = 'playing' | 'paused' | 'won' | 'lost';

export type GameEvent =
  | { type: 'spawn'; enemy: Enemy }
  | { type: 'defeat'; enemy: Enemy; item: LearningItem; firstTry: boolean }
  | { type: 'phase'; enemy: Enemy; item: LearningItem }
  | { type: 'wrong'; enemy: Enemy; item: LearningItem; evaluation: Evaluation }
  | { type: 'unclear'; enemy: Enemy | null; evaluation: Evaluation }
  | { type: 'breach'; enemy: Enemy; damage: number; returns: boolean }
  | { type: 'bossIntro'; enemy: Enemy }
  | { type: 'resolved'; item: LearningItem; wrongAttempts: number; solved: boolean; ms?: number }
  | { type: 'won' }
  | { type: 'lost' };

export interface LevelConfig {
  castleHp: number;
  /** Seconds between spawns. */
  spawnInterval: number;
  maxAlive: number;
  /** Multiplies every enemy's walk duration (pace setting × difficulty). */
  durationFactor: number;
  /** Fraction of normal speed while the child is reading aloud. */
  listeningSlow: number;
  /** Practice mode: enemies stop at the gate instead of hurting the castle. */
  practice?: boolean;
  /** How long the boss announcement lasts before the boss starts to walk. */
  bossIntroSeconds: number;
}

export interface LevelState {
  status: LevelStatus;
  time: number;
  castleHp: number;
  castleMax: number;
  enemies: Enemy[];
  nextSpawnAt: number;
  /** Length of the road in pixels. Speed is derived from it (see tick), so the
   *  time to reach the castle does not depend on screen size. */
  pathLength: number;
  /** Seconds of boss announcement left (nothing moves meanwhile). */
  intro: number;
  bossAnnounced: boolean;
  config: LevelConfig;
  listening: boolean;
  score: number;
  combo: number;
  correct: number;
  firstTry: number;
  wrong: number;
  breaches: number;
  events: GameEvent[];
}

/**
 * Seconds from spawn to castle at the default pace, for an enemy nobody reads.
 * A standard enemy (slime, goblin) takes 7 s; the others keep their identity:
 * bats are fast, knights are slow and armoured, the boss lumbers (and is
 * pushed back each time the child reads a word).
 */
export const WALK_SECONDS: Record<EnemyType, number> = {
  slime: 7, goblin: 7, bat: 5, knight: 9, boss: 40,
};
export const STANDARD_WALK_SECONDS = 7;

export const DAMAGE: Record<EnemyType, number> = {
  slime: 1, goblin: 1, bat: 1, knight: 2, boss: 2,
};

/** How far the boss is knocked back by each word read correctly. */
export const BOSS_KNOCKBACK = 0.2;

export const DEFAULT_CONFIG: LevelConfig = {
  castleHp: 5, spawnInterval: 6, maxAlive: 3, durationFactor: 1, listeningSlow: 0.5, bossIntroSeconds: 2.4,
};

/** Default road length until the renderer reports the real one. */
export const DEFAULT_PATH_LENGTH = 1000;

export function createLevelState(specs: EnemySpec[], config: Partial<LevelConfig> = {}): LevelState {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const enemies = specs.map((s, i): Enemy => ({
    id: i + 1, type: s.type, items: s.items, phase: 0, progress: 0,
    walkSeconds: WALK_SECONDS[s.type], assist: !!s.assist, status: 'waiting',
    wrong: 0, wrongTotal: 0, targetTime: 0, frozen: false, spawnIndex: i,
  }));
  return {
    status: 'playing', time: 0, castleHp: cfg.castleHp, castleMax: cfg.castleHp, enemies,
    nextSpawnAt: 1.5, pathLength: DEFAULT_PATH_LENGTH, intro: 0, bossAnnounced: false, config: cfg, listening: false, score: 0, combo: 0, correct: 0, firstTry: 0,
    wrong: 0, breaches: 0, events: [],
  };
}

export const alive = (s: LevelState) => s.enemies.filter((e) => e.status === 'walking');

/** The enemy the child should read: the one closest to the castle. */
export function currentTarget(s: LevelState): Enemy | null {
  let best: Enemy | null = null;
  for (const e of s.enemies) {
    if (e.status !== 'walking') continue;
    if (!best || e.progress > best.progress) best = e;
  }
  return best;
}

export const currentItem = (e: Enemy): LearningItem => e.items[Math.min(e.phase, e.items.length - 1)];

function spawnNext(s: LevelState): void {
  const next = s.enemies.find((e) => e.status === 'waiting' && e.type !== 'boss');
  if (!next) return;
  next.status = 'walking';
  s.events.push({ type: 'spawn', enemy: next });
}

/** Speed in pixels per second: the whole road in the enemy's walk time. */
export function speedOf(s: LevelState, e: Enemy): number {
  return s.pathLength / (e.walkSeconds * s.config.durationFactor);
}

/** Seconds this enemy needs to reach the castle from where it stands now. */
export function secondsToCastle(s: LevelState, e: Enemy): number {
  return ((1 - e.progress) * s.pathLength) / speedOf(s, e);
}

/** The road changed length (window resized): positions are kept as fractions,
 *  so nothing jumps, and speeds are re-derived from the new length. */
export function setPathLength(s: LevelState, length: number): void {
  if (length > 1) s.pathLength = length;
}

/**
 * The boss comes only after every regular enemy is dealt with, and is
 * announced first: nothing moves while the banner plays.
 */
function bossStep(s: LevelState, dt: number): boolean {
  const boss = s.enemies.find((e) => e.type === 'boss' && e.status === 'waiting');
  if (!boss) return false;
  if (s.enemies.some((e) => e.type !== 'boss' && (e.status === 'walking' || e.status === 'waiting'))) return false;
  if (!s.bossAnnounced) {
    s.bossAnnounced = true;
    s.intro = s.config.bossIntroSeconds;
    s.events.push({ type: 'bossIntro', enemy: boss });
  }
  s.intro -= dt;
  if (s.intro > 0) return true;
  s.intro = 0;
  boss.status = 'walking';
  s.events.push({ type: 'spawn', enemy: boss });
  return false;
}

export function tick(s: LevelState, dt: number): void {
  if (s.status !== 'playing') return;
  s.time += dt;

  if (bossStep(s, dt)) return;

  const walking = alive(s);
  const waiting = s.enemies.some((e) => e.status === 'waiting' && e.type !== 'boss');
  if (waiting && (walking.length === 0 || (s.time >= s.nextSpawnAt && walking.length < s.config.maxAlive))) {
    spawnNext(s);
    s.nextSpawnAt = s.time + s.config.spawnInterval;
  }

  const target = currentTarget(s);
  if (target) target.targetTime += dt;
  for (const e of alive(s)) {
    if (e.frozen) continue;
    // While the child speaks, monsters slow down - but only on the first part
    // of the road, so a noisy room can never hold one at the castle gate.
    const slow = s.listening && e.progress < LISTENING_SLOW_UNTIL ? s.config.listeningSlow : 1;
    // distance = speed × time, as a fraction of the road
    e.progress = Math.min(1, e.progress + (speedOf(s, e) * dt * slow) / s.pathLength);
    if (e.progress >= 1) breach(s, e);
  }
  checkEnd(s);
}

function breach(s: LevelState, e: Enemy): void {
  const damage = DAMAGE[e.type];
  if (s.config.practice) {
    // In practice the castle really is hit (the child sees it lose a heart),
    // but it never falls, and the monster goes back to try again.
    s.castleHp = Math.max(1, s.castleHp - 1);
    e.progress = 0;
    e.wrong = 0;
    s.events.push({ type: 'breach', enemy: e, damage: 1, returns: true });
    return;
  }
  s.castleHp = Math.max(0, s.castleHp - damage);
  s.breaches += 1;
  s.combo = 0;
  if (e.type === 'boss') {
    // The boss is never "passed" by reaching the castle: it hurts, then
    // lumbers back to the start with the words it still has to be read.
    e.progress = 0;
    e.wrong = 0;
    e.frozen = false;
    s.events.push({ type: 'breach', enemy: e, damage, returns: true });
    return;
  }
  e.status = 'breached';
  s.events.push({ type: 'breach', enemy: e, damage, returns: false });
  // Every unread phase is recorded as unsolved practice, not as a mistake.
  for (let p = e.phase; p < e.items.length; p++) {
    s.events.push({ type: 'resolved', item: e.items[p], wrongAttempts: p === e.phase ? e.wrong : 0, solved: false });
  }
}

function checkEnd(s: LevelState): void {
  if (s.status !== 'playing') return;
  if (s.castleHp <= 0) {
    s.status = 'lost';
    s.events.push({ type: 'lost' });
    return;
  }
  if (s.enemies.every((e) => e.status === 'defeated' || e.status === 'breached')) {
    s.status = 'won';
    s.events.push({ type: 'won' });
  }
}

/**
 * Apply one evaluated reading. `targetId` is the enemy that was the target
 * when listening began, so a reading is credited to the enemy the child was
 * looking at even if another enemy overtook it meanwhile. A correct reading
 * of any other walking enemy also counts — the child read it correctly.
 */
export function applyEvaluation(s: LevelState, targetId: number | null, ev: Evaluation, matchesOther?: (e: Enemy) => boolean): Enemy | null {
  if (s.status !== 'playing') return null;
  const target = s.enemies.find((e) => e.id === targetId && e.status === 'walking') ?? currentTarget(s);
  if (!target) return null;

  if (ev.outcome === 'uncertain') {
    s.events.push({ type: 'unclear', enemy: target, evaluation: ev });
    return null;
  }

  let hit: Enemy | null = ev.outcome === 'correct' ? target : null;
  if (!hit && matchesOther) {
    hit = alive(s).find((e) => e !== target && matchesOther(e)) ?? null;
  }

  if (!hit) {
    const item = currentItem(target);
    target.wrong += 1;
    target.wrongTotal += 1;
    s.wrong += 1;
    s.combo = 0;
    if (target.wrong >= 3) target.frozen = true;
    s.events.push({ type: 'wrong', enemy: target, item, evaluation: ev });
    return null;
  }

  const item = currentItem(hit);
  const firstTry = hit.wrong === 0;
  s.correct += 1;
  if (firstTry) s.firstTry += 1;
  s.combo += 1;
  s.score += (firstTry ? 150 : 100) + Math.min(s.combo - 1, 5) * 20;
  s.events.push({ type: 'resolved', item, wrongAttempts: hit.wrong, solved: true, ms: Math.round(hit.targetTime * 1000) });

  if (hit.phase < hit.items.length - 1) {
    hit.phase += 1;
    hit.wrong = 0;
    hit.targetTime = 0;
    hit.frozen = false;
    // A boss staggers back with each word it loses.
    hit.progress = Math.max(0, hit.progress - BOSS_KNOCKBACK);
    s.events.push({ type: 'phase', enemy: hit, item: currentItem(hit) });
  } else {
    hit.status = 'defeated';
    s.events.push({ type: 'defeat', enemy: hit, item, firstTry });
  }
  checkEnd(s);
  return hit;
}

export function setPaused(s: LevelState, paused: boolean): void {
  if (paused && s.status === 'playing') s.status = 'paused';
  else if (!paused && s.status === 'paused') s.status = 'playing';
}

export function drainEvents(s: LevelState): GameEvent[] {
  const ev = s.events;
  s.events = [];
  return ev;
}

/** 3 stars: no breaches and ≥80% first try. 2: castle above half. 1: survived. */
export function starsFor(s: LevelState): number {
  if (s.status !== 'won') return 0;
  const total = s.enemies.reduce((n, e) => n + e.items.length, 0);
  const ftRate = total ? s.firstTry / total : 0;
  if (s.breaches === 0 && ftRate >= 0.8) return 3;
  if (s.castleHp >= s.castleMax / 2) return 2;
  return 1;
}
