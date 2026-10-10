import { describe, expect, it } from 'vitest';
import { getPack } from '../src/content/registry';
import {
  alive, createLevelState, currentTarget, secondsToCastle, setPaused, setPathLength, speedOf, tick,
  STANDARD_WALK_SECONDS, WALK_SECONDS, type EnemySpec, type EnemyType, type LevelState,
} from '../src/game/levelState';

const en = getPack('en');
const cat = en.items.find((i) => i.id === 'en:word:cat')!;
const spec = (type: EnemyType): EnemySpec[] => [{ type, items: [cat] }];

/** Run until the first enemy reaches the castle; returns seconds since it spawned. */
function secondsUntilBreach(s: LevelState, dt: number): number {
  let spawnedAt = -1;
  for (let i = 0; i < 100000; i++) {
    tick(s, dt);
    const e = s.enemies[0];
    if (spawnedAt < 0 && e.status !== 'waiting') spawnedAt = s.time - dt;
    if (e.status === 'breached') return s.time - spawnedAt;
  }
  throw new Error('never reached the castle');
}

describe('enemy movement timing', () => {
  it('a standard enemy takes about 7 seconds to reach the castle', () => {
    for (const type of ['slime', 'goblin'] as const) {
      const s = createLevelState(spec(type));
      expect(secondsUntilBreach(s, 1 / 60)).toBeCloseTo(STANDARD_WALK_SECONDS, 1);
    }
    expect(STANDARD_WALK_SECONDS).toBe(7);
  });

  it('speed is derived from the road length: 7 s on a phone road and on a desktop road', () => {
    for (const length of [320, 900, 2400]) {
      const s = createLevelState(spec('goblin'));
      setPathLength(s, length);
      tick(s, 0.01);
      const e = s.enemies[0];
      expect(speedOf(s, e)).toBeCloseTo(length / 7, 6);     // px per second
      expect(secondsToCastle(s, e)).toBeCloseTo(7, 1);
      expect(secondsUntilBreach(s, 1 / 60)).toBeCloseTo(7, 1);
    }
  });

  it('the walk takes the same time whatever the frame rate', () => {
    const t30 = secondsUntilBreach(createLevelState(spec('goblin')), 1 / 30);
    const t144 = secondsUntilBreach(createLevelState(spec('goblin')), 1 / 144);
    expect(Math.abs(t30 - t144)).toBeLessThan(0.1);
  });

  it('resizing mid-walk keeps the position and the arrival time', () => {
    const s = createLevelState(spec('goblin'));
    setPathLength(s, 800);
    for (let i = 0; i < 210; i++) tick(s, 1 / 60); // 3.5 s in
    const e = alive(s)[0];
    const before = e.progress;
    expect(before).toBeCloseTo(0.5, 1);
    setPathLength(s, 2400); // window grows 3×
    expect(e.progress).toBe(before);                  // no jump
    expect(secondsToCastle(s, e)).toBeCloseTo(3.5, 1); // same time left
    let t = 0;
    while (e.status === 'walking') { tick(s, 1 / 60); t += 1 / 60; }
    expect(t).toBeCloseTo(3.5, 1);
  });

  it('other enemy types keep their identity relative to the standard one', () => {
    expect(WALK_SECONDS.bat).toBeLessThan(WALK_SECONDS.goblin);   // fast
    expect(WALK_SECONDS.knight).toBeGreaterThan(WALK_SECONDS.goblin); // armoured, slower
    expect(WALK_SECONDS.boss).toBeGreaterThan(WALK_SECONDS.knight);
    expect(secondsUntilBreach(createLevelState(spec('bat')), 1 / 60)).toBeCloseTo(5, 1);
    expect(secondsUntilBreach(createLevelState(spec('knight')), 1 / 60)).toBeCloseTo(9, 1);
  });

  it('pace setting and difficulty scale the 7 seconds, they do not replace it', () => {
    expect(secondsUntilBreach(createLevelState(spec('goblin'), { durationFactor: 1.45 }), 1 / 60)).toBeCloseTo(7 * 1.45, 1);
    expect(secondsUntilBreach(createLevelState(spec('goblin'), { durationFactor: 0.8 }), 1 / 60)).toBeCloseTo(7 * 0.8, 1);
  });

  it('pausing stops enemies and resuming continues without a jump', () => {
    const s = createLevelState(spec('goblin'));
    for (let i = 0; i < 120; i++) tick(s, 1 / 60); // 2 s
    const e = alive(s)[0];
    setPaused(s, true);
    const p = e.progress;
    for (let i = 0; i < 6000; i++) tick(s, 1 / 60); // 100 s "paused"
    expect(e.progress).toBe(p);
    expect(s.status).toBe('paused');
    setPaused(s, false);
    let t = 0;
    while (e.status === 'walking') { tick(s, 1 / 60); t += 1 / 60; }
    expect(t).toBeCloseTo(5, 1); // 7 s total, 2 already walked
  });

  it('a restarted level starts from scratch', () => {
    const a = createLevelState(spec('goblin'));
    for (let i = 0; i < 200; i++) tick(a, 1 / 60);
    const b = createLevelState(spec('goblin'));
    expect(b.time).toBe(0);
    expect(b.enemies[0].progress).toBe(0);
    expect(b.enemies[0].status).toBe('waiting');
    expect(secondsUntilBreach(b, 1 / 60)).toBeCloseTo(7, 1);
  });

  it('the child gets more time while reading aloud', () => {
    const s = createLevelState(spec('goblin'));
    tick(s, 0.1);
    s.listening = true;
    for (let i = 0; i < 300; i++) tick(s, 1 / 60); // 5 s of reading
    expect(currentTarget(s)!.progress).toBeLessThan(0.4); // 5 s at half speed of a 7 s walk ≈ 36 %
  });
});
