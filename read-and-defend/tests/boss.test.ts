import { describe, expect, it } from 'vitest';
import { getPack, knownSkills } from '../src/content/registry';
import { selectBossWords, selectLevelItems } from '../src/content/selector';
import { createRng } from '../src/core/rng';
import { evaluate } from '../src/evaluation/evaluator';
import { buildLevels } from '../src/game/levels';
import {
  applyEvaluation, createLevelState, currentItem, currentTarget, drainEvents, tick, type EnemySpec, type LevelState,
} from '../src/game/levelState';
import { buildEnemyPlan } from '../src/game/plan';
import { PROFILES } from '../src/learning/adaptive';
import { createLearner } from '../src/learning/learner';

const normal = PROFILES.normal;
const packs = { en: getPack('en'), he: getPack('he') };
const en = packs.en;
const w = (x: string) => en.items.find((i) => i.id === `en:word:${x}`)!;
const say = (t: string) => [{ transcript: t }];

describe('every level ends with a boss', () => {
  it('all levels, in both languages, are boss levels', () => {
    for (const pack of Object.values(packs)) {
      const levels = buildLevels(pack);
      expect(levels.length).toBeGreaterThan(10);
      expect(levels.every((l) => l.boss)).toBe(true);
    }
  });

  it('the enemy plan of every level ends with exactly one boss of exactly three words', () => {
    for (const pack of Object.values(packs)) {
      for (const level of buildLevels(pack)) {
        const sel = selectLevelItems(pack, level.unitIndex, createLearner(), { count: level.enemyCount, rng: createRng(level.number), profile: normal, boss: true });
        const plan = buildEnemyPlan(sel, createLearner(), normal);
        const bosses = plan.filter((e) => e.type === 'boss');
        expect(bosses, level.id).toHaveLength(1);
        expect(plan[plan.length - 1].type).toBe('boss');
        expect(bosses[0].items, level.id).toHaveLength(3);
      }
    }
  });
});

describe('boss words', () => {
  it('are three different real words, easiest first, in every unit of both languages', () => {
    for (const pack of Object.values(packs)) {
      pack.units.forEach((_, ui) => {
        for (let seed = 1; seed <= 6; seed++) {
          const b = selectBossWords(pack, ui, createLearner(), { rng: createRng(seed * 31 + ui) });
          expect(b.items, `${pack.lang} unit ${ui}`).toHaveLength(3);
          expect(new Set(b.items.map((i) => i.display)).size).toBe(3);
          for (const it of b.items) { expect(it.kind).toBe('word'); expect(it.isRealWord).toBe(true); }
          expect(b.items[0].difficulty).toBeLessThanOrEqual(b.items[1].difficulty);
          expect(b.items[1].difficulty).toBeLessThanOrEqual(b.items[2].difficulty);
        }
      });
    }
  });

  it('use only sounds the child has been taught (English: always; Hebrew: from the third unit)', () => {
    for (const [lang, firstStrict] of [['en', 0], ['he', 2]] as const) {
      const pack = packs[lang];
      const free = new Set(pack.bossFreeSkills);
      for (let ui = firstStrict; ui < pack.units.length; ui++) {
        const known = knownSkills(pack, ui);
        for (let seed = 1; seed <= 8; seed++) {
          const b = selectBossWords(pack, ui, createLearner(), { rng: createRng(seed + ui * 100) });
          expect(b.assist, `${lang} unit ${ui}`).toBe(false);
          for (const it of b.items) {
            const unknown = it.skills.filter((k) => !known.has(k) && !free.has(k));
            expect(unknown, `${lang} unit ${ui}: ${it.display}`).toEqual([]);
          }
        }
      }
    }
  });

  it('the first Hebrew levels (no vowel taught yet) show the sound breakdown from the start', () => {
    const b = selectBossWords(packs.he, 0, createLearner(), { rng: createRng(1) });
    expect(b.assist).toBe(true);
    // …and still only need a vowel or two beyond the letters taught
    const known = knownSkills(packs.he, 0);
    for (const it of b.items) expect(it.skills.filter((k) => !known.has(k)).length).toBeLessThanOrEqual(2);
  });

  it('English level 1 uses very short words built from s, a, t, p', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const b = selectBossWords(en, 0, createLearner(), { rng: createRng(seed) });
      for (const it of b.items) {
        expect(it.display.length).toBeLessThanOrEqual(4);
        expect([...it.display].every((c) => 'satp'.includes(c))).toBe(true);
      }
    }
  });

  it('get longer and more complex as the course advances', () => {
    const avgLen = (pack: typeof en, ui: number) => {
      let n = 0, total = 0;
      for (let seed = 1; seed <= 20; seed++) for (const it of selectBossWords(pack, ui, createLearner(), { rng: createRng(seed) }).items) { total += it.difficulty; n++; }
      return total / n;
    };
    expect(avgLen(en, 9)).toBeGreaterThan(avgLen(en, 0));
    expect(avgLen(packs.he, 7)).toBeGreaterThan(avgLen(packs.he, 2));
  });

  it('a retry keeps the unit but fights a boss with different words', () => {
    for (const [pack, ui] of [[en, 3], [en, 6], [packs.he, 3], [packs.he, 5]] as const) {
      const learner = createLearner();
      const first = selectBossWords(pack, ui, learner, { rng: createRng(1) }).items.map((i) => i.id);
      const retry = selectBossWords(pack, ui, learner, { rng: createRng(2), previous: [first] }).items.map((i) => i.id);
      expect(retry).not.toEqual(first);
      expect(retry.filter((id) => first.includes(id)).length).toBeLessThanOrEqual(1);
    }
  });

  it('even English level 1 (a small pool) varies between attempts', () => {
    const learner = createLearner();
    const sets = new Set<string>();
    let previous: string[][] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const ids = selectBossWords(en, 0, learner, { rng: createRng(attempt + 5), previous }).items.map((i) => i.id).sort();
      sets.add(ids.join('|'));
      previous = [ids, ...previous];
    }
    expect(sets.size).toBeGreaterThanOrEqual(2);
  });

  it('do not repeat words the child already read earlier in the same level', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const sel = selectLevelItems(en, 3, createLearner(), { count: 8, rng: createRng(seed), profile: normal, boss: true });
      const shown = new Set(sel.items.map((i) => i.display));
      for (const b of sel.boss) expect(shown.has(b.display)).toBe(false);
    }
  });

  it('prefer words the child has never seen (transfer, not memory)', () => {
    const learner = createLearner();
    const seen = en.items.filter((i) => i.kind === 'word').slice(0, 60);
    for (const it of seen) learner.items[it.id] = { seen: 3, attempts: 3, solved: 3, firstTry: 3, lastSeen: 0, msTotal: 0, msCount: 0 };
    let novel = 0, total = 0;
    for (let seed = 1; seed <= 30; seed++) {
      for (const it of selectBossWords(en, 8, learner, { rng: createRng(seed) }).items) { total++; if (!learner.items[it.id]) novel++; }
    }
    expect(novel / total).toBeGreaterThan(0.7);
  });
});

/* ---------------------------------------------------------- boss fight */

function bossLevel(): LevelState {
  const regular: EnemySpec[] = [{ type: 'goblin', items: [w('cat')] }, { type: 'goblin', items: [w('sun')] }];
  return createLevelState([...regular, { type: 'boss', items: [w('map'), w('pig'), w('fish')] }]);
}
const readNow = (s: LevelState, text?: string) => {
  const t = currentTarget(s)!;
  return applyEvaluation(s, t.id, evaluate(currentItem(t), say(text ?? currentItem(t).display)));
};
function defeatRegulars(s: LevelState) {
  for (let guard = 0; guard < 50 && s.enemies.some((e) => e.type !== 'boss' && e.status !== 'defeated'); guard++) {
    tick(s, 0.1);
    if (currentTarget(s) && currentTarget(s)!.type !== 'boss') readNow(s);
  }
}

describe('boss fight', () => {
  it('only appears after every regular enemy is dealt with, and is announced first', () => {
    const s = bossLevel();
    const boss = s.enemies.find((e) => e.type === 'boss')!;
    for (let i = 0; i < 40; i++) { tick(s, 0.1); if (boss.status !== 'waiting') break; if (currentTarget(s)) readNow(s); }
    // the boss must not have appeared while a regular enemy was still alive/waiting
    const events = drainEvents(s);
    const intro = events.findIndex((e) => e.type === 'bossIntro');
    expect(intro).toBeGreaterThanOrEqual(0);
    const regularsLeft = s.enemies.filter((e) => e.type !== 'boss' && (e.status === 'walking' || e.status === 'waiting'));
    expect(regularsLeft).toHaveLength(0);
  });

  it('nothing moves during the announcement, then the boss starts to walk', () => {
    const s = bossLevel();
    defeatRegulars(s);
    const boss = s.enemies.find((e) => e.type === 'boss')!;
    let guard = 0;
    while (s.intro <= 0 && boss.status === 'waiting' && guard++ < 50) tick(s, 0.05);
    expect(s.intro).toBeGreaterThan(0);
    expect(boss.status).toBe('waiting');
    expect(currentTarget(s)).toBeNull();                 // nothing to read yet
    const t0 = s.intro;
    tick(s, 1);
    expect(s.intro).toBeCloseTo(t0 - 1, 5);
    expect(boss.progress).toBe(0);
    for (let i = 0; i < 40; i++) tick(s, 0.1);
    expect(boss.status).toBe('walking');
  });

  it('shows exactly one word at a time, in order, and needs exactly three correct readings', () => {
    const s = bossLevel();
    defeatRegulars(s);
    while (!currentTarget(s)) tick(s, 0.1);
    const boss = currentTarget(s)!;
    expect(boss.type).toBe('boss');
    const shown: string[] = [];
    for (let stage = 0; stage < 3; stage++) {
      shown.push(currentItem(boss).display);
      expect(boss.phase).toBe(stage);
      expect(boss.status).toBe('walking');
      expect(s.status).toBe('playing');
      readNow(s);
    }
    expect(shown).toEqual(boss.items.map((i) => i.display));
    expect(new Set(shown).size).toBe(3);
    expect(boss.status).toBe('defeated');
    expect(s.status).toBe('won');
  });

  it('wrong and uncertain readings never advance the boss', () => {
    const s = bossLevel();
    defeatRegulars(s);
    while (!currentTarget(s)) tick(s, 0.1);
    const boss = currentTarget(s)!;
    readNow(s); // first word
    expect(boss.phase).toBe(1);
    readNow(s, 'banana');                       // wrong
    applyEvaluation(s, boss.id, evaluate(currentItem(boss), [])); // silence
    applyEvaluation(s, boss.id, evaluate(currentItem(boss), [{ transcript: 'pi', confidence: 0.1 }])); // unclear
    expect(boss.phase).toBe(1);
    expect(boss.status).toBe('walking');
    expect(s.correct).toBe(s.enemies.filter((e) => e.type !== 'boss').length + 1);
    // the word is still the second one, and can still be read
    expect(currentItem(boss).display).toBe('pig');
    readNow(s);
    expect(boss.phase).toBe(2);
  });

  it('reading a word the boss is not showing does not advance it', () => {
    const s = bossLevel();
    defeatRegulars(s);
    while (!currentTarget(s)) tick(s, 0.1);
    const boss = currentTarget(s)!;
    readNow(s, 'fish'); // that is the THIRD word
    expect(boss.phase).toBe(0);
  });

  it('cannot be beaten by waiting: reaching the castle hurts, the boss returns, the level is not won', () => {
    const s = bossLevel();
    defeatRegulars(s);
    while (!currentTarget(s)) tick(s, 0.1);
    const boss = currentTarget(s)!;
    readNow(s); // one word done
    const hp = s.castleHp;
    boss.progress = 0.9999;
    tick(s, 0.5);
    expect(s.castleHp).toBeLessThan(hp);
    expect(s.status).toBe('playing');
    expect(boss.status).toBe('walking');
    expect(boss.progress).toBe(0);          // lumbered back to the start
    expect(boss.phase).toBe(1);             // progress is kept
    expect(drainEvents(s).some((e) => e.type === 'breach' && e.returns)).toBe(true);
    // waiting long enough eventually costs the whole castle, never the win
    for (let i = 0; i < 20000 && s.status === 'playing'; i++) tick(s, 0.1);
    expect(s.status).toBe('lost');
  });

  it('every reading is recorded individually for learning', () => {
    const s = bossLevel();
    defeatRegulars(s);
    drainEvents(s);
    while (!currentTarget(s)) tick(s, 0.1);
    drainEvents(s);
    readNow(s); readNow(s); readNow(s);
    const resolved = drainEvents(s).filter((e) => e.type === 'resolved');
    expect(resolved).toHaveLength(3);
    expect(resolved.every((e) => e.type === 'resolved' && e.solved)).toBe(true);
  });

  it('boss reading goes through the same evaluator in Hebrew', () => {
    const he = packs.he;
    const words = he.items.filter((i) => i.kind === 'word' && i.niqqud).slice(0, 3);
    const s = createLevelState([{ type: 'boss', items: words }]);
    while (!currentTarget(s)) tick(s, 0.1);
    const boss = currentTarget(s)!;
    for (const wd of words) {
      expect(currentItem(boss).id).toBe(wd.id);
      applyEvaluation(s, boss.id, evaluate(currentItem(boss), say('מכונית')));
      expect(boss.phase).toBe(words.indexOf(wd));
      applyEvaluation(s, boss.id, evaluate(currentItem(boss), say(wd.accepted[0])));
    }
    expect(s.status).toBe('won');
  });
});
