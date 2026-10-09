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
  /** Items to read in order; a boss may need several. */
  items: LearningItem[];
}

export type EnemyStatus = 'waiting' | 'walking' | 'defeated' | 'breached';

export interface Enemy {
  id: number;
  type: EnemyType;
  items: LearningItem[];
  phase: number;
  /** 0 at the spawn point, 1 at the castle gate. */
  progress: number;
  /** Seconds to walk the whole path at normal speed. */
  duration: number;
  status: EnemyStatus;
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
  | { type: 'breach'; enemy: Enemy; damage: number }
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
}

export interface LevelState {
  status: LevelStatus;
  time: number;
  castleHp: number;
  castleMax: number;
  enemies: Enemy[];
  nextSpawnAt: number;
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

export const BASE_DURATION: Record<EnemyType, number> = {
  slime: 38, goblin: 44, bat: 30, knight: 54, boss: 80,
};

export const DAMAGE: Record<EnemyType, number> = {
  slime: 1, goblin: 1, bat: 1, knight: 2, boss: 3,
};

export const DEFAULT_CONFIG: LevelConfig = {
  castleHp: 5, spawnInterval: 6, maxAlive: 3, durationFactor: 1, listeningSlow: 0.2,
};

export function createLevelState(specs: EnemySpec[], config: Partial<LevelConfig> = {}): LevelState {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const enemies = specs.map((s, i): Enemy => ({
    id: i + 1, type: s.type, items: s.items, phase: 0, progress: 0,
    duration: BASE_DURATION[s.type] * cfg.durationFactor, status: 'waiting',
    wrong: 0, wrongTotal: 0, targetTime: 0, frozen: false, spawnIndex: i,
  }));
  return {
    status: 'playing', time: 0, castleHp: cfg.castleHp, castleMax: cfg.castleHp, enemies,
    nextSpawnAt: 1.5, config: cfg, listening: false, score: 0, combo: 0, correct: 0, firstTry: 0,
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
  const next = s.enemies.find((e) => e.status === 'waiting');
  if (!next) return;
  next.status = 'walking';
  s.events.push({ type: 'spawn', enemy: next });
}

export function tick(s: LevelState, dt: number): void {
  if (s.status !== 'playing') return;
  s.time += dt;

  const walking = alive(s);
  const waiting = s.enemies.some((e) => e.status === 'waiting');
  if (waiting && (walking.length === 0 || (s.time >= s.nextSpawnAt && walking.length < s.config.maxAlive))) {
    spawnNext(s);
    s.nextSpawnAt = s.time + s.config.spawnInterval;
  }

  const target = currentTarget(s);
  if (target) target.targetTime += dt;
  const slow = s.listening ? s.config.listeningSlow : 1;
  for (const e of alive(s)) {
    if (e.frozen) continue;
    e.progress = Math.min(1, e.progress + (dt * slow) / e.duration);
    if (e.progress >= 1) breach(s, e);
  }
  checkEnd(s);
}

function breach(s: LevelState, e: Enemy): void {
  if (s.config.practice) {
    // In practice the enemy waits at the gate; nothing is lost.
    e.progress = 0.999;
    e.frozen = true;
    return;
  }
  e.status = 'breached';
  const damage = DAMAGE[e.type];
  s.castleHp = Math.max(0, s.castleHp - damage);
  s.breaches += 1;
  s.combo = 0;
  s.events.push({ type: 'breach', enemy: e, damage });
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
    // A boss staggers back a little with each phase it loses.
    hit.progress = Math.max(0, hit.progress - 0.12);
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
