import { describe, expect, it } from 'vitest';
import { getPack } from '../src/content/registry';
import { eligibleItems } from '../src/content/selector';
import { chooseDifficulty, scaffoldFor } from '../src/learning/adaptive';
import { createLearner, isMastered, recentAccuracy, recordResult, transferRate, weakSkills } from '../src/learning/learner';

const en = getPack('en');
const words = eligibleItems(en, en.units.findIndex((u) => u.id === 'en-8'));

describe('learner model', () => {
  it('tracks attempts, first-try success and transfer', () => {
    const l = createLearner();
    recordResult(l, { item: words[0], wrongAttempts: 0, solved: true, ms: 1800 });
    recordResult(l, { item: words[1], wrongAttempts: 2, solved: true });
    recordResult(l, { item: words[2], wrongAttempts: 1, solved: false });
    expect(l.items[words[0].id].firstTry).toBe(1);
    expect(l.items[words[1].id].attempts).toBe(3);
    expect(l.transfer).toEqual({ attempts: 3, firstTry: 1 });
  });

  it('does not count repeating one word as mastery', () => {
    const l = createLearner();
    const cat = en.items.find((i) => i.id === 'en:word:cat')!;
    for (let i = 0; i < 30; i++) recordResult(l, { item: cat, wrongAttempts: 0, solved: true });
    expect(isMastered(l, 'en:G:c')).toBe(false); // only one distinct item
    expect(l.transfer.attempts).toBe(1);          // only the first time was new
  });

  it('masters a skill from success across different items', () => {
    const l = createLearner();
    const withA = words.filter((w) => w.skills.includes('en:G:a')).slice(0, 8);
    for (const w of withA) recordResult(l, { item: w, wrongAttempts: 0, solved: true });
    expect(isMastered(l, 'en:G:a')).toBe(true);
  });

  it('identifies difficult letter-sound relationships', () => {
    const l = createLearner();
    const mix = words.filter((x) => x.skills.includes('en:G:e') !== x.skills.includes('en:G:a'));
    for (const w of mix) {
      const hard = w.skills.includes('en:G:e');
      recordResult(l, { item: w, wrongAttempts: hard ? 2 : 0, solved: !hard });
    }
    expect(l.skills['en:G:e'].score).toBeLessThan(l.skills['en:G:a'].score);
    expect(weakSkills(l)).toContain('en:G:e');
    expect(weakSkills(l)).not.toContain('en:G:a');
  });
});

describe('difficulty progression', () => {
  it('starts at normal', () => {
    expect(chooseDifficulty(createLearner()).mode).toBe('normal');
  });

  it('eases off when the child struggles', () => {
    const l = createLearner();
    for (const w of words.slice(0, 10)) recordResult(l, { item: w, wrongAttempts: 2, solved: true });
    expect(chooseDifficulty(l).mode).toBe('ease');
  });

  it('raises the challenge only with success on NEW words', () => {
    const l = createLearner();
    for (const w of words.slice(0, 12)) recordResult(l, { item: w, wrongAttempts: 0, solved: true });
    expect(transferRate(l)).toBe(1);
    expect(chooseDifficulty(l).mode).toBe('challenge');
  });

  it('repeating familiar words does not raise the challenge', () => {
    const l = createLearner();
    // Struggled with new words…
    for (const w of words.slice(0, 6)) recordResult(l, { item: w, wrongAttempts: 2, solved: true });
    // …then read the same two words over and over.
    for (let i = 0; i < 20; i++) recordResult(l, { item: words[i % 2], wrongAttempts: 0, solved: true });
    expect(chooseDifficulty(l).mode).not.toBe('challenge');
    expect(recentAccuracy(l)).toBeDefined();
  });

  it('a parent cap holds the difficulty down', () => {
    const l = createLearner();
    for (const w of words.slice(0, 12)) recordResult(l, { item: w, wrongAttempts: 0, solved: true });
    expect(chooseDifficulty(l, 'normal').mode).toBe('normal');
    expect(chooseDifficulty(l, 'ease').mode).toBe('ease');
  });

  it('scaffolding grows with repeated difficulty', () => {
    expect(scaffoldFor(0)).toEqual({ highlight: false, breakdown: false, listen: false, freeze: false });
    expect(scaffoldFor(1).breakdown).toBe(true);
    expect(scaffoldFor(2).listen).toBe(true);
    expect(scaffoldFor(3).freeze).toBe(true);
  });
});
