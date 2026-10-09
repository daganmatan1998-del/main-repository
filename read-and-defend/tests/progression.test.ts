import { describe, expect, it } from 'vitest';
import { getPack, knownSkills } from '../src/content/registry';
import { eligibleItems, selectLevelItems, unitReady, unitView } from '../src/content/selector';
import { createRng } from '../src/core/rng';
import { buildLevels } from '../src/game/levels';
import { chooseDifficulty, PROFILES } from '../src/learning/adaptive';
import { createLearner, recordResult, type LearnerState } from '../src/learning/learner';
import { fastTrackTarget, levelDone } from '../src/progress/fastTrack';
import { newLangProgress, type LangProgress } from '../src/progress/profile';

const en = getPack('en');
const he = getPack('he');
const normal = PROFILES.normal;

/** How a unit looked in the first version of the game (levels 1–4 must not change). */
const kindsAt = (pack: typeof en, ui: number) => Object.keys(pack.units[ui].kinds).sort();
const firstWordUnit = (pack: typeof en) => pack.units.findIndex((u) => !!u.kinds.word);

describe('the first levels keep their difficulty', () => {
  it('English levels 1–4 are letters only, with the same letters and difficulty ceiling as before', () => {
    expect(kindsAt(en, 0)).toEqual(['letter']);
    expect(kindsAt(en, 1)).toEqual(['letter']);
    expect(en.units[0].newSkills).toEqual(['s', 'a', 't', 'p'].map((c) => `en:G:${c}`));
    expect(en.units[1].newSkills).toEqual(['i', 'n', 'd', 'm'].map((c) => `en:G:${c}`).sort((a, b) => 'indm'.indexOf(a.slice(-1)) - 'indm'.indexOf(b.slice(-1))));
    expect(en.units[0].maxDifficulty).toBe(1.2);
    expect(en.units[1].maxDifficulty).toBe(1.2);
    expect(eligibleItems(en, 0)).toHaveLength(8);   // s a t p, lower and upper case
    expect(eligibleItems(en, 1)).toHaveLength(16);
  });

  it('Hebrew level 1–2 keep the same four opening letters, letters only', () => {
    expect(kindsAt(he, 0)).toEqual(['letter']);
    expect(he.units[0].newSkills).toEqual(['בּ', 'מ', 'ל', 'שׁ'].map((c) => `he:L:${c}`));
    expect(eligibleItems(he, 0)).toHaveLength(4);
  });

  it('a new learner sees exactly the unit as written: no look-ahead until they have shown fluency', () => {
    for (const pack of [en, he]) {
      pack.units.forEach((u, ui) => {
        const v = unitView(pack, ui, createLearner());
        expect(v.ahead).toBe(false);
        expect(v.kinds).toEqual(u.kinds);
        expect(v.ceiling).toBe(u.maxDifficulty);
      });
    }
  });

  it('the first level never contains a word enemy', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const sel = selectLevelItems(en, 0, createLearner(), { count: 6, rng: createRng(seed), profile: normal });
      expect(sel.items.every((i) => i.kind === 'letter')).toBe(true);
    }
  });
});

describe('the course reaches syllables and words sooner', () => {
  it('first words arrive at unit 3 (level 5) instead of unit 7 (level 13) in English', () => {
    expect(firstWordUnit(en) + 1).toBe(3);
    expect(firstWordUnit(en)).toBeLessThan(6); // the first version had them at unit index 6
  });

  it('first syllables and words arrive by unit 3 in Hebrew (they were units 3 and 5)', () => {
    expect(he.units.findIndex((u) => !!u.kinds.syllable)).toBeLessThanOrEqual(1);
    expect(firstWordUnit(he)).toBe(2);
    expect(firstWordUnit(he)).toBeLessThan(4);
  });

  it('the whole course is shorter, with nothing dropped', () => {
    expect(en.units.length).toBeLessThan(16);
    expect(he.units.length).toBeLessThan(13);
    for (const pack of [en, he]) {
      const taught = knownSkills(pack, pack.units.length - 1);
      expect(pack.items.every((it) => it.skills.every((k) => taught.has(k)))).toBe(true);
    }
    // blends, magic-e, vowel teams, shva, unpointed reading and sentences are all still taught
    for (const id of ['en:P:blend', 'en:G:a_e', 'en:G:ee', 'en:T:the']) expect(knownSkills(en, en.units.length - 1).has(id)).toBe(true);
    for (const id of ['he:V:shva', 'he:P:plain', 'he:V:o', 'he:V:u']) expect(knownSkills(he, he.units.length - 1).has(id)).toBe(true);
    expect(en.units.some((u) => u.kinds.sentence)).toBe(true);
    expect(he.units.some((u) => u.kinds.sentence)).toBe(true);
  });

  it('difficulty ceilings rise steadily', () => {
    for (const pack of [en, he]) {
      for (let i = 1; i < pack.units.length; i++) expect(pack.units[i].maxDifficulty).toBeGreaterThanOrEqual(pack.units[i - 1].maxDifficulty);
    }
  });
});

/* ---------------------------------------------------- ability, not level */

function learnerWho(pack: typeof en, unitIndex: number, firstTry: boolean, items = 40): LearnerState {
  const l = createLearner();
  const pool = eligibleItems(pack, unitIndex).filter((i) => i.kind !== 'sentence');
  for (let i = 0; i < items; i++) recordResult(l, { item: pool[i % pool.length], wrongAttempts: firstTry ? 0 : 2, solved: true });
  return l;
}

describe('progression follows demonstrated ability', () => {
  it('a reader fluent in a letters unit starts getting the next unit’s short words', () => {
    const ui = 1; // i n d m, letters only
    const fluent = learnerWho(en, ui, true);
    expect(unitReady(en, ui, fluent)).toBe(true);
    const v = unitView(en, ui, fluent);
    expect(v.ahead).toBe(true);
    expect(v.kinds.word).toBeGreaterThan(0);
    const items = eligibleItems(en, ui, normal, fluent);
    expect(items.some((i) => i.kind === 'word')).toBe(true);
    // …made only of letters already taught
    const known = knownSkills(en, ui);
    for (const it of items) expect(it.skills.every((k) => known.has(k) || k === 'en:P:cvc')).toBe(true);
    // a reader who is not fluent gets the unit as written
    const struggling = learnerWho(en, ui, false);
    expect(unitReady(en, ui, struggling)).toBe(false);
    expect(eligibleItems(en, ui, normal, struggling).every((i) => i.kind === 'letter')).toBe(true);
  });

  it('Hebrew letters unit also moves on to syllables once letters are fluent', () => {
    const ui = 0;
    const fluent = learnerWho(he, ui, true, 30);
    expect(unitReady(he, ui, fluent)).toBe(true);
  });

  it('repeating the same item perfectly does not count as being ready', () => {
    const l = createLearner();
    const s = en.items.find((i) => i.id === 'en:letter:s')!;
    for (let i = 0; i < 60; i++) recordResult(l, { item: s, wrongAttempts: 0, solved: true });
    expect(unitReady(en, 0, l)).toBe(false);
  });

  it('look-ahead never introduces a letter or vowel that has not been taught', () => {
    for (const pack of [en, he]) {
      pack.units.forEach((_, ui) => {
        const fluent = learnerWho(pack, ui, true, 60);
        const v = unitView(pack, ui, fluent);
        const base = knownSkills(pack, ui);
        for (const k of v.known) {
          if (!base.has(k)) expect(pack.skills[k].kind, k).toBe('pattern');
        }
      });
    }
  });

  it('a struggling reader is eased, with supportive practice, not pushed ahead', () => {
    const l = learnerWho(en, 3, false, 20);
    expect(chooseDifficulty(l).mode).toBe('ease');
    expect(unitView(en, 3, l).ahead).toBe(false);
  });

  it('level 1 still takes a new child through letters first', () => {
    expect(selectLevelItems(en, 0, createLearner(), { count: 6, rng: createRng(1), profile: normal }).items.every((i) => i.kind === 'letter')).toBe(true);
  });
});

describe('fast-track skips practice levels for readers who have mastered a unit', () => {
  const levels = buildLevels(en);
  const withLearner = (l: LearnerState): LangProgress => ({ ...newLangProgress(), learner: l });

  it('skips the unit’s second level after a 3-star win by a fluent reader of new words', () => {
    const ui = 3;
    const l = createLearner();
    // fluent in the unit's sounds, reading unseen words first try
    for (const it of eligibleItems(en, ui).filter((i) => i.kind === 'word')) recordResult(l, { item: it, wrongAttempts: 0, solved: true });
    for (const k of en.units[ui].newSkills) expect(l.skills[k]).toBeDefined();
    const lp = withLearner(l);
    const won = levels.find((x) => x.unitIndex === ui)!;
    const target = fastTrackTarget(lp, en, levels, won, 3);
    expect(target?.id).toBe(levels.filter((x) => x.unitIndex === ui)[1].id);
  });

  it('never in the first two units — the first four levels stay as they are', () => {
    for (const ui of [0, 1]) {
      const l = learnerWho(en, ui, true, 80);
      expect(fastTrackTarget(withLearner(l), en, levels, levels.find((x) => x.unitIndex === ui)!, 3)).toBeNull();
    }
  });

  it('not without 3 stars, not for a weak reader, not twice', () => {
    const ui = 3;
    const l = createLearner();
    for (const it of eligibleItems(en, ui).filter((i) => i.kind === 'word')) recordResult(l, { item: it, wrongAttempts: 0, solved: true });
    const won = levels.find((x) => x.unitIndex === ui)!;
    expect(fastTrackTarget(withLearner(l), en, levels, won, 2)).toBeNull();
    expect(fastTrackTarget(withLearner(learnerWho(en, ui, false, 30)), en, levels, won, 3)).toBeNull();
    const lp = withLearner(l);
    const second = levels.filter((x) => x.unitIndex === ui)[1];
    lp.levels[second.id] = { stars: 0, bestScore: 0, attempts: 0, wins: 0, history: [], skipped: true };
    expect(fastTrackTarget(lp, en, levels, won, 3)).toBeNull();
  });

  it('skipped levels count as done, so the map and the next-level logic move on', () => {
    const lp = newLangProgress();
    lp.levels['en-3b'] = { stars: 0, bestScore: 0, attempts: 0, wins: 0, history: [], skipped: true };
    expect(levelDone(lp, 'en-3b')).toBe(true);
    expect(levelDone(lp, 'en-4a')).toBe(false);
  });
});
