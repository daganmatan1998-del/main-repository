import { describe, expect, it } from 'vitest';
import { getPack } from '../src/content/registry';
import { evaluate } from '../src/evaluation/evaluator';
import {
  applyEvaluation, createLevelState, currentItem, currentTarget, drainEvents, setPaused, starsFor, tick,
  type EnemySpec,
} from '../src/game/levelState';

const en = getPack('en');
const w = (x: string) => en.items.find((i) => i.id === `en:word:${x}`)!;
const specs = (...ws: string[]): EnemySpec[] => ws.map((x) => ({ type: 'goblin', items: [w(x)] }));
const read = (t: string) => [{ transcript: t }];

function readTarget(s: ReturnType<typeof createLevelState>, text?: string) {
  const target = currentTarget(s)!;
  const item = currentItem(target);
  return applyEvaluation(s, target.id, evaluate(item, read(text ?? item.display)));
}

describe('level state', () => {
  it('spawns enemies and moves them toward the castle', () => {
    const s = createLevelState(specs('cat', 'sun'));
    tick(s, 0.1);
    const e = currentTarget(s)!;
    expect(e).not.toBeNull();
    const p0 = e.progress;
    tick(s, 2);
    expect(e.progress).toBeGreaterThan(p0);
  });

  it('a correct reading defeats the target', () => {
    const s = createLevelState(specs('cat', 'sun'));
    tick(s, 0.1);
    const hit = readTarget(s);
    expect(hit?.status).toBe('defeated');
    expect(s.correct).toBe(1);
    expect(drainEvents(s).some((e) => e.type === 'defeat')).toBe(true);
  });

  it('an incorrect reading does not defeat it', () => {
    const s = createLevelState(specs('cat'));
    tick(s, 0.1);
    const target = currentTarget(s)!;
    readTarget(s, 'dog');
    expect(target.status).toBe('walking');
    expect(target.wrong).toBe(1);
    expect(s.correct).toBe(0);
  });

  it('an uncertain reading changes nothing and allows another attempt', () => {
    const s = createLevelState(specs('cat'));
    tick(s, 0.1);
    const target = currentTarget(s)!;
    applyEvaluation(s, target.id, evaluate(w('cat'), []));
    expect(target.wrong).toBe(0);
    expect(target.status).toBe('walking');
    expect(drainEvents(s).some((e) => e.type === 'unclear')).toBe(true);
    readTarget(s);
    expect(target.status).toBe('defeated');
  });

  it('a correct reading of another visible enemy also counts', () => {
    const s = createLevelState(specs('cat', 'sun'), { spawnInterval: 0.5 });
    tick(s, 0.1); tick(s, 1);
    const target = currentTarget(s)!;
    const other = s.enemies.find((e) => e.status === 'walking' && e !== target)!;
    const ev = evaluate(currentItem(target), read(currentItem(other).display));
    const hit = applyEvaluation(s, target.id, ev, (e) => evaluate(currentItem(e), read(currentItem(other).display)).outcome === 'correct');
    expect(hit).toBe(other);
    expect(target.wrong).toBe(0);
  });

  it('reaching the castle costs health', () => {
    const s = createLevelState(specs('cat', 'sun', 'map'));
    tick(s, 0.1);
    for (let i = 0; i < 500 && s.breaches === 0; i++) tick(s, 0.1);
    expect(s.breaches).toBe(1);
    expect(s.castleHp).toBe(4);
    expect(drainEvents(s).some((e) => e.type === 'resolved' && !e.solved)).toBe(true);
  });

  it('listening slows the enemies down', () => {
    const a = createLevelState(specs('cat')); tick(a, 0.1);
    const b = createLevelState(specs('cat')); tick(b, 0.1);
    b.listening = true;
    tick(a, 3); tick(b, 3);
    expect(currentTarget(b)!.progress).toBeLessThan(currentTarget(a)!.progress);
  });

  it('can be won', () => {
    const s = createLevelState(specs('cat', 'sun', 'map'));
    for (let i = 0; i < 3; i++) { tick(s, 0.1); tick(s, 7); readTarget(s); }
    expect(s.status).toBe('won');
    expect(starsFor(s)).toBe(3);
  });

  it('can be lost', () => {
    const s = createLevelState(specs('cat', 'sun', 'map', 'pig', 'hen', 'dog'), { castleHp: 3 });
    for (let i = 0; i < 5000 && s.status === 'playing'; i++) tick(s, 0.1);
    expect(s.status).toBe('lost');
    expect(starsFor(s)).toBe(0);
  });

  it('pausing stops time', () => {
    const s = createLevelState(specs('cat')); tick(s, 0.1);
    const e = currentTarget(s)!;
    setPaused(s, true);
    const p = e.progress;
    tick(s, 5);
    expect(e.progress).toBe(p);
    setPaused(s, false);
    tick(s, 1);
    expect(e.progress).toBeGreaterThan(p);
  });

  it('practice mode never damages the castle', () => {
    const s = createLevelState(specs('cat'), { practice: true });
    for (let i = 0; i < 1000; i++) tick(s, 0.1);
    expect(s.castleHp).toBe(s.castleMax);
    expect(s.status).toBe('playing');
    readTarget(s);
    expect(s.status).toBe('won');
  });

  it('three wrong readings freeze the enemy (no time pressure)', () => {
    const s = createLevelState(specs('cat')); tick(s, 0.1);
    const e = currentTarget(s)!;
    for (let i = 0; i < 3; i++) readTarget(s, 'dog');
    expect(e.frozen).toBe(true);
    const p = e.progress;
    tick(s, 5);
    expect(e.progress).toBe(p);
  });

  it('a boss needs every phase read', () => {
    const s = createLevelState([{ type: 'boss', items: [w('cat'), w('sun'), w('map')] }]);
    tick(s, 0.1);
    const boss = currentTarget(s)!;
    readTarget(s); readTarget(s);
    expect(boss.status).toBe('walking');
    expect(boss.phase).toBe(2);
    readTarget(s);
    expect(boss.status).toBe('defeated');
    expect(s.status).toBe('won');
  });
});
