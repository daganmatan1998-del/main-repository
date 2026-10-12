import { describe, expect, it } from 'vitest';
import { getPack, knownSkills } from '../src/content/registry';
import { BOSS_WORDS, selectBossWords, selectLevelItems } from '../src/content/selector';
import { createRng } from '../src/core/rng';
import { evaluate } from '../src/evaluation/evaluator';
import { buildLevels } from '../src/game/levels';
import {
  applyEvaluation, bossWalkSeconds, createLevelState, currentItem, currentTarget, drainEvents, tick, type EnemySpec, type LevelState,
} from '../src/game/levelState';
import { buildEnemyPlan } from '../src/game/plan';
import { PROFILES } from '../src/learning/adaptive';
import { createLearner } from '../src/learning/learner';

const normal = PROFILES.normal;
const packs = { en: getPack('en'), he: getPack('he') };
const en = packs.en;
const w = (x: string) => en.items.find((i) => i.id === `en:word:${x}`)!;
const say = (t: string) => [{ transcript: t }];

describe('worlds: regular levels of ten monsters, a boss fight at the end of each world', () => {
  it('regular levels have exactly ten monsters and no boss; the last level of every world is its boss', () => {
    for (const pack of Object.values(packs)) {
      const levels = buildLevels(pack);
      const stages = [...new Set(pack.units.map((u) => u.stage))];
      const bosses = levels.filter((l) => l.boss);
      expect(bosses.map((l) => l.stage)).toEqual(stages);            // one boss per world
      for (const stage of stages) {
        const world = levels.filter((l) => l.stage === stage);
        expect(world[world.length - 1].boss, `${pack.lang} world ${stage}`).toBe(true);
        expect(world.slice(0, -1).every((l) => !l.boss && l.enemyCount === 10)).toBe(true);
      }
      levels.forEach((l, i) => expect(l.number).toBe(i + 1));
    }
  });

  it('a regular level is ten monsters with no boss among them', () => {
    for (const pack of Object.values(packs)) {
      for (const level of buildLevels(pack).filter((l) => !l.boss)) {
        const sel = selectLevelItems(pack, level.unitIndex, createLearner(), { count: level.enemyCount, rng: createRng(level.number), profile: normal, boss: false });
        const plan = buildEnemyPlan(sel, createLearner(), normal);
        expect(plan, level.id).toHaveLength(10);
        expect(plan.some((e) => e.type === 'boss')).toBe(false);
      }
    }
  });

  it('each world\'s boss is faster than the last, and still leaves several seconds per word', () => {
    const walks = [1, 2, 3, 4, 5, 6].map(bossWalkSeconds);
    for (let i = 1; i < walks.length; i++) expect(walks[i]).toBeLessThan(walks[i - 1]);
    for (const wk of walks) expect(wk / BOSS_WORDS).toBeGreaterThanOrEqual(6.5);
  });

  it('boss words get harder from world to world', () => {
    for (const pack of Object.values(packs)) {
      const bossLevels = buildLevels(pack).filter((l) => l.boss);
      const mean = bossLevels.map((l) => {
        let sum = 0; let n = 0;
        for (let seed = 1; seed <= 12; seed++) {
          for (const it of selectBossWords(pack, l.unitIndex, createLearner(), { rng: createRng(seed * 7 + l.stage), stage: l.stage }).items) {
            sum += it.difficulty + 0.12 * [...it.display.replace(/[\u0591-\u05C7]/g, '')].length; n++;
          }
        }
        return sum / n;
      });
      // never easier than the world before (the first two English worlds are both
      // three-letter words, so they may tie), and clearly harder by the end
      for (let i = 1; i < mean.length; i++) expect(mean[i], `${pack.lang} world ${i + 1}`).toBeGreaterThan(mean[i - 1] - 0.05);
      expect(mean[mean.length - 1]).toBeGreaterThan(mean[0] + 1);
    }
  });
});

describe('boss words', () => {
  it('are six different real words, easiest first, in every unit of both languages', () => {
    for (const pack of Object.values(packs)) {
      pack.units.forEach((_, ui) => {
        for (let seed = 1; seed <= 6; seed++) {
          const b = selectBossWords(pack, ui, createLearner(), { rng: createRng(seed * 31 + ui) });
          expect(b.items, `${pack.lang} unit ${ui}`).toHaveLength(BOSS_WORDS);
          expect(new Set(b.items.map((i) => i.display)).size).toBe(BOSS_WORDS);
          for (const it of b.items) { expect(it.kind).toBe('word'); expect(it.isRealWord).toBe(true); }
          for (let i = 1; i < b.items.length; i++) expect(b.items[i - 1].difficulty).toBeLessThanOrEqual(b.items[i].difficulty);
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

  it('a correct word does not push the boss back: it keeps coming with its next word', () => {
    const s = bossLevel();
    defeatRegulars(s);
    while (!currentTarget(s)) tick(s, 0.1);
    const boss = currentTarget(s)!;
    for (let i = 0; i < 30; i++) tick(s, 0.1);
    const before = boss.progress;
    expect(before).toBeGreaterThan(0);
    readNow(s);
    expect(boss.phase).toBe(1);
    expect(boss.progress).toBe(before);     // no knock-back
    tick(s, 0.5);
    expect(boss.progress).toBeGreaterThan(before);
  });

  it('at the castle the boss strikes one heart per blow until it is read; waiting loses', () => {
    const s = bossLevel();
    defeatRegulars(s);
    while (!currentTarget(s)) tick(s, 0.1);
    const boss = currentTarget(s)!;
    readNow(s); // one word done
    expect(s.castleHp).toBe(2);
    boss.progress = 0.9999;
    tick(s, 0.2);
    expect(s.castleHp).toBe(1);             // first blow on arrival
    expect(boss.status).toBe('walking');
    expect(boss.progress).toBe(1);          // it stays at the gate
    expect(boss.phase).toBe(1);             // progress is kept
    expect(drainEvents(s).some((e) => e.type === 'breach' && e.damage === 1)).toBe(true);
    for (let i = 0; i < 20 && s.castleHp === 1; i++) tick(s, 0.1);   // the next blow, ~4 s later
    expect(s.status).toBe('playing');
    for (let i = 0; i < 25; i++) tick(s, 0.1);
    expect(s.status).toBe('lost');
    expect(s.lostReason).toBe('castle');
  });

  it('bought hearts give more blows of time', () => {
    const s = createLevelState([{ type: 'boss', items: bossLevel().enemies.find((e) => e.type === 'boss')!.items }], { castleHp: 5 });
    expect(s.castleMax).toBe(5);
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
