import { describe, expect, it } from 'vitest';
import { getPack } from '../src/content/registry';
import { configForMode } from '../src/evaluation/config';
import { prefixCoverage } from '../src/evaluation/evaluator';
import { createLevelState, tick, type Enemy } from '../src/game/levelState';
import { matchUtterance, readingOrder, tokenize } from '../src/game/utterance';

const he = getPack('he');
const en = getPack('en');
const cfg = configForMode('normal');
const letter = (l: string) => he.items.find((i) => i.kind === 'letter' && i.display === l)!;
const heWord = (w: string) => he.items.find((i) => i.kind === 'word' && i.niqqud && i.display === w.normalize('NFC'))!;
const enWord = (w: string) => en.items.find((i) => i.id === `en:word:${w}`)!;
const say = (...t: string[]) => t.map((transcript) => ({ transcript }));

/** Walking enemies holding the given items, nearest the castle first. */
function road(items: Array<ReturnType<typeof letter>>, boss = false): Enemy[] {
  const s = createLevelState(boss ? [{ type: 'boss', items }] : items.map((it) => ({ type: 'slime' as const, items: [it] })), { maxAlive: 9, spawnInterval: 0 });
  for (let i = 0; i < 60; i++) tick(s, 0.05);
  s.enemies.forEach((e, i) => { e.status = 'walking'; e.progress = 0.9 - i * 0.1; });
  return readingOrder(s.enemies);
}

describe('fast reading: several readings in one breath', () => {
  it('credits every letter read in one utterance, in order', () => {
    const enemies = road([letter('מ'), letter('ל'), letter('שׁ')]);
    const hits = matchUtterance(say('מם למד שין'), enemies, { lang: 'he', final: true, cfg });
    expect(hits.map((h) => h.enemyId)).toEqual(enemies.map((e) => e.id));
  });

  it('works when letters are read out of the road order', () => {
    const enemies = road([letter('מ'), letter('ל'), letter('שׁ')]);
    const hits = matchUtterance(say('שין מם'), enemies, { lang: 'he', final: true, cfg });
    expect(new Set(hits.map((h) => h.enemyId))).toEqual(new Set([enemies[2].id, enemies[0].id]));
  });

  it('English words in one breath', () => {
    const enemies = road([enWord('cat'), enWord('sun'), enWord('map')]);
    expect(matchUtterance(say('cat sun map'), enemies, { lang: 'en', final: true, cfg })).toHaveLength(3);
  });

  it('a boss can lose several words in one breath, in order only', () => {
    const enemies = road([enWord('cat'), enWord('sun'), enWord('map')], true);
    expect(matchUtterance(say('cat sun'), enemies, { lang: 'en', final: true, cfg }).map((h) => h.phase)).toEqual([0, 1]);
    // the second word without the first does nothing: one word at a time
    expect(matchUtterance(say('sun'), enemies, { lang: 'en', final: true, cfg })).toEqual([]);
  });

  it('checks every alternative the engine offers', () => {
    const enemies = road([enWord('ship')]);
    expect(matchUtterance(say('chip', 'ship'), enemies, { lang: 'en', final: true, cfg })).toHaveLength(1);
  });
});

describe('the room is not the reader', () => {
  it('background conversation does not defeat monsters', () => {
    const enemies = road([letter('מ'), letter('ל')]);
    expect(matchUtterance(say('מה אתה עושה היום'), enemies, { lang: 'he', final: true, cfg })).toEqual([]);
    expect(matchUtterance(say('we are going to the park later'), road([enWord('cat')]), { lang: 'en', final: true, cfg })).toEqual([]);
  });

  it('inside a sentence a short word is not taken as a letter', () => {
    const enemies = road([letter('מ')]);
    expect(matchUtterance(say('מה זה'), enemies, { lang: 'he', final: true, cfg })).toEqual([]);
    // …but on its own, "מה" is how engines often write the letter מ
    expect(matchUtterance(say('מה'), enemies, { lang: 'he', final: true, cfg })).toHaveLength(1);
    expect(matchUtterance(say('לא רוצה'), road([letter('ל')]), { lang: 'he', final: true, cfg })).toEqual([]);
  });

  it('the first two letters of שין, למד, מם, נון are enough - also in a fast run of letters', () => {
    for (const [l, short] of [['שׁ', 'שי'], ['ל', 'לא'], ['ל', 'לה'], ['מ', 'מה'], ['מ', 'מי'], ['נ', 'נו'], ['נ', 'נא']]) {
      expect(matchUtterance(say(short), road([letter(l)]), { lang: 'he', final: true, cfg }), short).toHaveLength(1);
    }
    // four letters read quickly, each cut short
    const four = road([letter('שׁ'), letter('ל'), letter('מ'), letter('נ')]);
    expect(matchUtterance(say('שי לא מה נו'), four, { lang: 'he', final: true, cfg })).toHaveLength(4);
    // a short form never stands in for a different letter
    expect(matchUtterance(say('נו'), road([letter('מ')]), { lang: 'he', final: true, cfg })).toEqual([]);
    expect(matchUtterance(say('לא'), road([letter('נ')]), { lang: 'he', final: true, cfg })).toEqual([]);
  });

  it('wrong readings credit nothing', () => {
    expect(matchUtterance(say('dog'), road([enWord('cat')]), { lang: 'en', final: true, cfg })).toEqual([]);
    expect(matchUtterance(say('נון'), road([letter('מ')]), { lang: 'he', final: true, cfg })).toEqual([]);
  });
});

describe('guessing from how a word starts', () => {
  it('measures how much of the word a heard beginning covers', () => {
    expect(prefixCoverage(heWord('שֻׁלְחָן'), 'שול', cfg)).toBeCloseTo(2 / 4, 2);   // ש ל of ש ל ח נ
    expect(prefixCoverage(heWord('מַחְבֶּרֶת'), 'מחבר', cfg)).toBeCloseTo(0.8, 2);
    expect(prefixCoverage(enWord('splash'), 'splas', cfg)).toBeCloseTo(5 / 6, 2);
  });

  it('a complete different word is not a beginning', () => {
    expect(prefixCoverage(heWord('קוֹף'), 'קום', cfg)).toBe(0);
    expect(prefixCoverage(enWord('cat'), 'cap', cfg)).toBe(0);
    expect(prefixCoverage(heWord('שֻׁלְחָן'), 'מכו', cfg)).toBe(0);
  });

  it('short words, letters and syllables are never guessed', () => {
    expect(prefixCoverage(heWord('דָּג'), 'ד', cfg)).toBe(0);
    expect(prefixCoverage(letter('מ'), 'מ', cfg)).toBe(0);
    expect(prefixCoverage(enWord('cat'), 'ca', cfg)).toBe(0);
  });

  it('credits a long word while it is still being said (partial result)', () => {
    const enemies = road([heWord('מַחְבֶּרֶת')]);
    expect(matchUtterance(say('מחבר'), enemies, { lang: 'he', final: false, cfg }).map((h) => h.via)).toEqual(['prefix']);
    expect(matchUtterance(say('מח'), enemies, { lang: 'he', final: false, cfg })).toEqual([]); // too early to tell
  });

  it('when the engine cuts the word short, the beginning it caught can still count', () => {
    const enemies = road([heWord('מַחְבֶּרֶת')]);
    // מחב = 3 of 5 consonants: not enough while still speaking, enough if the engine stopped there
    expect(matchUtterance(say('מחב'), enemies, { lang: 'he', final: false, cfg })).toEqual([]);
    expect(matchUtterance(say('מחב'), enemies, { lang: 'he', final: true, cfg }).map((h) => h.via)).toEqual(['prefix']);
  });

  it('only the monster nearest the castle is guessed', () => {
    const enemies = road([enWord('cat'), enWord('splash')]);
    expect(matchUtterance(say('splas'), enemies, { lang: 'en', final: true, cfg })).toEqual([]);
  });

  it('the exact mode turns guessing off', () => {
    const enemies = road([heWord('מַחְבֶּרֶת')]);
    expect(matchUtterance(say('מחבר'), enemies, { lang: 'he', final: true, cfg: configForMode('strict') })).toEqual([]);
  });
});

describe('pointed syllables (engines that return niqqud, and the simulator)', () => {
  const syl = (d: string) => he.items.find((i) => i.kind === 'syllable' && i.display === d.normalize('NFC'))!;
  it('a syllable read with its vowel mark is credited', () => {
    for (const d of ['שַׁ', 'סִ', 'נִ', 'יָ', 'בּוֹ']) {
      expect(matchUtterance(say(d), road([syl(d)]), { lang: 'he', final: true, cfg }), d).toHaveLength(1);
    }
  });
  it('…and a different vowel is not', () => {
    expect(matchUtterance(say('שִׁ'), road([syl('שַׁ')]), { lang: 'he', final: true, cfg })).toEqual([]);
  });
  it('every item in both banks is credited when read exactly as shown', () => {
    for (const pack of [he, en]) {
      const bad = pack.items.filter((it) => it.kind !== 'sentence' && matchUtterance(say(it.display), road([it]), { lang: pack.lang, final: true, cfg }).length !== 1);
      expect(bad.map((b) => b.id)).toEqual([]);
    }
  });
});

describe('tokens', () => {
  it('drops hesitations but keeps words', () => {
    expect(tokenize('אה... מם, למד!', 'he')).toEqual(['מם', 'למד']);
    expect(tokenize('um, cat. Sun!', 'en')).toEqual(['cat', 'Sun']);
  });
  it('keeps vowel marks, which are the most precise evidence', () => {
    expect(tokenize('שַׁ', 'he')).toEqual(['שַׁ']);
  });
});
