import { describe, expect, it } from 'vitest';
import { getPack } from '../src/content/registry';
import { evaluate } from '../src/evaluation/evaluator';
import type { LearningItem } from '../src/content/types';
import { configForMode, HEBREW_PRESETS, type EvalConfig } from '../src/evaluation/config';
import { stripNiqqud } from '../src/content/hebrew/script';
import { letterSpellings } from '../src/content/english/data';

const en = getPack('en');
const he = getPack('he');
const item = (pack: typeof en, id: string): LearningItem => {
  const it = pack.items.find((x) => x.id === id);
  if (!it) throw new Error('missing ' + id);
  return it;
};
const say = (...t: string[]) => t.map((transcript) => ({ transcript }));

describe('English evaluation', () => {
  it('accepts the target word, case and punctuation aside', () => {
    expect(evaluate(item(en, 'en:word:cat'), say('Cat.')).outcome).toBe('correct');
    expect(evaluate(item(en, 'en:word:cat'), say('um cat')).outcome).toBe('correct');
  });
  it('accepts homophones the recogniser may choose', () => {
    expect(evaluate(item(en, 'en:word:sun'), say('son')).outcome).toBe('correct');
  });
  it('rejects a different word and points to the sound that differs', () => {
    const r = evaluate(item(en, 'en:word:cat'), say('cap'));
    expect(r.outcome).toBe('incorrect');
    expect(r.focusPart).toBe(2); // c-a-[t]
  });
  it('checks every alternative, not only the first', () => {
    expect(evaluate(item(en, 'en:word:ship'), say('chip', 'ship')).outcome).toBe('correct');
  });
  it('accepts letter names', () => {
    expect(evaluate(item(en, 'en:letter:b'), say('bee')).outcome).toBe('correct');
    expect(evaluate(item(en, 'en:letter:S'), say('the letter s')).outcome).toBe('correct');
    expect(evaluate(item(en, 'en:letter:b'), say('dee')).outcome).toBe('incorrect');
  });
  it('treats silence and low confidence as uncertain, never as a mistake', () => {
    expect(evaluate(item(en, 'en:word:cat'), []).outcome).toBe('uncertain');
    expect(evaluate(item(en, 'en:word:cat'), [{ transcript: '' }]).outcome).toBe('uncertain');
    expect(evaluate(item(en, 'en:word:cat'), [{ transcript: 'hat', confidence: 0.2 }]).outcome).toBe('uncertain');
    expect(evaluate(item(en, 'en:word:cat'), say('and then we went to the park with my mum')).outcome).toBe('uncertain');
  });
  it('still accepts a correct reading with low confidence', () => {
    expect(evaluate(item(en, 'en:word:cat'), [{ transcript: 'cat', confidence: 0.2 }]).outcome).toBe('correct');
  });
  it('requires most words of a sentence, in order', () => {
    const s = item(en, 'en:sent:the-cat-is-on-the-bed');
    expect(evaluate(s, say('the cat is on the bed')).outcome).toBe('correct');
    expect(evaluate(s, say('the cat is on bed')).outcome).toBe('correct'); // 5/6
    const r = evaluate(s, say('the cat'));
    expect(r.outcome).toBe('incorrect');
    expect(r.wordsRead).toEqual([true, true, false, false, false, false]);
  });
});

describe('Hebrew evaluation', () => {
  it('accepts unpointed recogniser output for pointed words', () => {
    expect(evaluate(item(he, 'he:word:דָּג'), say('דג')).outcome).toBe('correct');
    expect(evaluate(item(he, 'he:word:שָׁלוֹם'), say('שלום')).outcome).toBe('correct');
  });
  it('accepts plene spelling of a defective-spelled word', () => {
    expect(evaluate(item(he, 'he:word:כִּתָּה'), say('כיתה')).outcome).toBe('correct');
    expect(evaluate(item(he, 'he:word:שֻׁלְחָן'), say('שולחן')).outcome).toBe('correct');
  });
  it('accepts sound-alike spellings (ט/ת, כ/ק) of the same pronunciation', () => {
    expect(evaluate(item(he, 'he:word:טַל'), say('תל')).outcome).toBe('correct');
  });
  it('rejects a different word', () => {
    expect(evaluate(item(he, 'he:word:גּוּר'), say('גיר')).outcome).toBe('incorrect');
    expect(evaluate(item(he, 'he:word:סוּס'), say('דג')).outcome).toBe('incorrect');
  });
  it('does not accept a different word just because its letters overlap', () => {
    const w = (d: string) => item(he, 'he:word:' + d.normalize('NFC'));
    expect(evaluate(w('מָה'), say('אמא')).outcome).toBe('incorrect');
    // An extra silent alef is ambiguous (the engine may have added it): try again, never accepted.
    expect(evaluate(w('בָּא'), say('אבא')).outcome).toBe('uncertain');
    expect(evaluate(w('שִׁיר'), say('שר')).outcome).toBe('incorrect');
    expect(evaluate(w('יוֹם'), say('ים')).outcome).toBe('incorrect');
    expect(evaluate(w('חָלָב'), say('כלב')).outcome).toBe('incorrect');
    expect(evaluate(item(he, 'he:syl:' + 'בּוֹ'.normalize('NFC')), say('בא')).outcome).toBe('incorrect');
  });
  it('accepts true homophones, which a recogniser cannot tell apart', () => {
    expect(evaluate(item(he, 'he:word:' + 'עוֹף'.normalize('NFC')), say('אף')).outcome).toBe('correct'); // א/ע are both silent
  });
  it('is strict about the vowel in CV syllables', () => {
    const ba = item(he, 'he:syl:' + 'בָּ'.normalize('NFC'));
    expect(evaluate(ba, say('בא')).outcome).toBe('correct');
    expect(evaluate(ba, say('בה')).outcome).toBe('correct');
    expect(evaluate(ba, say('בי')).outcome).toBe('incorrect');
    const bo = item(he, 'he:syl:' + 'בּוֹ'.normalize('NFC'));
    expect(evaluate(bo, say('בו')).outcome).toBe('correct');
  });
  it('calls a bare consonant for a syllable uncertain, not wrong', () => {
    const bi = item(he, 'he:syl:' + 'בִּ'.normalize('NFC'));
    expect(evaluate(bi, say('ב')).outcome).toBe('uncertain');
  });
  it('accepts letter names', () => {
    expect(evaluate(item(he, 'he:letter:ל'), say('למד')).outcome).toBe('correct');
    expect(evaluate(item(he, 'he:letter:ל'), say('מם')).outcome).toBe('incorrect');
  });
  it('evaluates sentences word by word', () => {
    const s = he.items.find((x) => x.kind === 'sentence' && x.display.startsWith('הַכֶּלֶב'))!;
    expect(evaluate(s, say('הכלב רץ')).outcome).toBe('correct');
    expect(evaluate(s, say('הכלב')).outcome).toBe('incorrect');
  });
});

describe('self-consistency over the whole bank', () => {
  it('every item is accepted when read exactly as displayed', () => {
    for (const pack of [en, he]) {
      const bad = pack.items.filter((it) => evaluate(it, say(it.display)).outcome !== 'correct');
      expect(bad.map((b) => b.id)).toEqual([]);
    }
  });
  it('every Hebrew word is accepted in the plain spelling a recogniser returns', () => {
    const bad = he.items.filter((it) => it.kind === 'word' && evaluate(it, say(it.accepted[it.accepted.length - 1])).outcome !== 'correct');
    expect(bad.map((b) => b.id)).toEqual([]);
  });
  it('no two different English words of the bank accept each other', () => {
    const words = en.items.filter((i) => i.kind === 'word');
    const clashes: string[] = [];
    for (const a of words) for (const b of words) {
      if (a !== b && evaluate(a, say(b.display)).outcome === 'correct') clashes.push(`${a.display}<-${b.display}`);
    }
    expect(clashes).toEqual([]);
  });
});


describe('English letters said as sounds', () => {
  const letter = (l: string) => en.items.find((i) => i.kind === 'letter' && i.display === l)!;
  const ok = (l: string, said: string) => evaluate(letter(l), say(said)).outcome === 'correct';

  it('accepts drawn-out, doubled and schwa-ended sounds, and the usual mishearings', () => {
    for (const [l, said] of [['s', 'sss'], ['s', 'yes'], ['s', 'us'], ['m', 'mm'], ['m', 'hmm'], ['m', 'him'], ['f', 'fff'], ['l', 'lll'], ['l', 'hell'],
      ['n', 'nn'], ['z', 'zzz'], ['b', 'buh'], ['d', 'duh'], ['t', 'tuh'], ['k', 'kuh'], ['c', 'kuh'], ['g', 'guh'], ['p', 'puh'], ['r', 'ruh'], ['h', 'huh'],
      ['u', 'uh'], ['o', 'on'], ['i', 'it'], ['a', 'at'], ['v', 'vvv'], ['j', 'juh'], ['w', 'wuh'], ['y', 'yuh'], ['x', 'eggs'], ['q', 'kwuh']]) {
      expect(ok(l, said), `${l} heard as "${said}"`).toBe(true);
    }
  });

  it('a sound is never credited to the wrong letter', () => {
    const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
    const seen = new Map<string, string>();
    for (const l of letters) {
      for (const w of letterSpellings(l)) {
        const owner = seen.get(w);
        // c and k are the same sound, so they may share it ("kuh").
        const sameSound = !!owner && ['c', 'k'].includes(owner) && ['c', 'k'].includes(l);
        expect(owner === undefined || owner === l || sameSound, `"${w}" belongs to both ${owner} and ${l}`).toBe(true);
        seen.set(w, l);
      }
    }
  });
});

describe('Hebrew phonetic layer — isolated letters', () => {
  const letter = (l: string) => he.items.find((i) => i.kind === 'letter' && i.display === l)!;
  const ok = (l: string, said: string, cfg?: EvalConfig) => evaluate(letter(l), say(said), cfg).outcome;

  it('accepts the transcriptions engines actually return for a correctly spoken letter', () => {
    // מ: the engine heard "mem", "mm", "me", "ma", "am" — all spelled differently
    for (const said of ['מ', 'מם', 'ממ', 'מים', 'מה', 'מי', 'אם', 'האות מם', 'mem']) expect(ok('מ', said), said).toBe('correct');
    for (const said of ['ל', 'למד', 'לאמד', 'לה', 'לי']) expect(ok('ל', said), said).toBe('correct');
    for (const said of ['ש', 'שין', 'שי', 'שה']) expect(ok('שׁ', said), said).toBe('correct');
    for (const said of ['ר', 'ריש', 'רי', 'ראש'.slice(0, 2)]) expect(ok('ר', said), said).toBe('correct');
  });

  it('ל and ש: cut-off, drawn-out and doubled names are the letter', () => {
    for (const said of ['למה', 'למ', 'לם', 'לל', 'lamed', 'lamad']) expect(ok('ל', said), said).toBe('correct');
    for (const said of ['שש', 'shh', 'shhh', 'she', 'shin', 'sheen']) expect(ok('שׁ', said), said).toBe('correct');
    // ...but the cut-off name rule does not open the door to other letters
    expect(ok('ל', 'מם')).not.toBe('correct');
    expect(ok('שׁ', 'סמך')).not.toBe('correct');
    expect(ok('ל', 'נון')).not.toBe('correct');
  });

  it('accepts niqqud, final forms and punctuation differences', () => {
    expect(ok('מ', 'מֵם')).toBe('correct');
    expect(ok('מ', 'ם')).toBe('correct');     // final mem is the same sound
    expect(ok('נ', 'נוּן.')).toBe('correct');
    expect(ok('ך', 'כ')).toBe('correct');
    expect(ok('ם', 'מם סופית')).toBe('correct');
  });

  it('accepts same-sound letters, which no recogniser can tell apart', () => {
    expect(ok('ט', 'ת')).toBe('correct');
    expect(ok('ת', 'טית')).toBe('correct');
    expect(ok('א', 'ע')).toBe('correct');
  });

  it('never accepts a different letter said clearly', () => {
    const names: Record<string, string> = { 'מ': 'מם', 'נ': 'נון', 'ל': 'למד', 'ר': 'ריש', 'ד': 'דלת', 'ג': 'גימל', 'ב': 'בית', 'ס': 'סמך', 'צ': 'צדי', 'ק': 'קוף' };
    for (const [target, tn] of Object.entries(names)) {
      for (const [other, on] of Object.entries(names)) {
        if (target === other) continue;
        const r = evaluate(letter(target), say(on)).outcome;
        expect(r, `${target} heard as ${on}`).not.toBe('correct');
        expect(r, `${target} heard as ${on}`).toBe('incorrect');
      }
      void tn;
    }
  });

  it('an unexpected word is "try again", not "wrong" — the engine may simply have misheard', () => {
    expect(ok('מ', 'שלום')).toBe('uncertain');
    expect(ok('פּ', 'כסא')).toBe('uncertain');
    expect(evaluate(letter('מ'), say('שלום')).reason).toBe('ambiguous');
  });

  it('recovers a short word that starts with the right sound, using the expected target', () => {
    // "מה" ("what") is what engines often return for the sound of מ
    expect(ok('מ', 'מה')).toBe('correct');
    // …but not a short word starting with a different sound
    expect(ok('מ', 'לא')).not.toBe('correct');
  });

  it('is far more forgiving than exact matching, and the modes are ordered', () => {
    const outputs = ['מ', 'מם', 'מים', 'מה', 'אם', 'מי', 'ממ'];
    const accepted = (mode: 'strict' | 'normal' | 'lenient') => outputs.filter((o) => ok('מ', o, configForMode(mode)) === 'correct').length;
    expect(accepted('normal')).toBeGreaterThan(accepted('strict'));
    expect(accepted('lenient')).toBeGreaterThanOrEqual(accepted('normal'));
  });

  it('whole-alphabet check: plausible outputs accepted, other letters rejected', () => {
    const letters = he.items.filter((i) => i.kind === 'letter');
    const base = (l: LearningItem) => l.display.normalize('NFD').replace(/[\u0591-\u05C7]/g, '');
    let total = 0, accepted = 0, falseTotal = 0, falseHit = 0;
    for (const l of letters) {
      const L = base(l), name = stripNiqqud(l.speakAs);
      for (const said of [L, name, name + 'ה', L + 'ה', L + 'י', 'האות ' + L]) {
        total++;
        if (evaluate(l, say(said)).outcome === 'correct') accepted++;
      }
      for (const o of letters) {
        if (o === l || evaluate(l, say(stripNiqqud(o.speakAs)), configForMode('strict')).outcome === 'correct') continue; // same-sound twins
        falseTotal++;
        if (evaluate(l, say(stripNiqqud(o.speakAs))).outcome === 'correct') falseHit++;
      }
    }
    expect(accepted / total).toBeGreaterThan(0.85);
    expect(falseHit / falseTotal).toBeLessThan(0.01);
  });

  it('low engine confidence on a non-match is still "try again"', () => {
    expect(evaluate(letter('מ'), [{ transcript: 'נון', confidence: 0.2 }]).outcome).toBe('uncertain');
  });
});

describe('Hebrew phonetic layer — syllables and words', () => {
  const syl = (s: string) => he.items.find((i) => i.kind === 'syllable' && i.display === s.normalize('NFC'))!;
  const word = (s: string) => he.items.find((i) => i.kind === 'word' && i.niqqud && i.display === s.normalize('NFC'))!;

  it('syllables: tolerant about the consonant, strict about the vowel', () => {
    expect(evaluate(syl('מָ'), say('מא')).outcome).toBe('correct');
    expect(evaluate(syl('מִ'), say('מי')).outcome).toBe('correct');
    expect(evaluate(syl('מוּ'), say('מו')).outcome).toBe('correct');
    expect(evaluate(syl('מוֹ'), say('מו')).outcome).toBe('correct');
    expect(evaluate(syl('מִ'), say('מא')).outcome).toBe('incorrect'); // consonant right, vowel wrong
    expect(evaluate(syl('מוֹ'), say('מי')).outcome).toBe('incorrect');
  });

  it('syllables: a near-confusion of the consonant is "try again", not wrong', () => {
    // נ for מ is a classic recogniser confusion — not accepted, but not condemned
    expect(evaluate(syl('מָ'), say('נא')).outcome).not.toBe('correct');
  });

  it('words are held to a higher standard than letters', () => {
    expect(evaluate(word('דָּג'), say('דג')).outcome).toBe('correct');
    expect(evaluate(word('דָּג'), say('דק')).outcome).not.toBe('correct');
    expect(evaluate(word('כֶּלֶב'), say('קלב')).outcome).toBe('correct');   // כ/ק spelling variant
    expect(evaluate(word('גָּדוֹל'), say('גדולה')).outcome).not.toBe('correct'); // different ending
    expect(evaluate(word('קוֹרֵא'), say('קרא')).outcome).not.toBe('correct');   // kore ≠ kara
  });

  it('a long word tolerates one acoustically close consonant, a short one does not', () => {
    expect(evaluate(word('שֻׁלְחָן'), say('שולחם')).outcome).not.toBe('incorrect');
    expect(evaluate(word('שָׁם'), say('שן')).outcome).toBe('incorrect');
  });

  it('thresholds are configurable without touching the evaluator', () => {
    const picky: EvalConfig = { ...configForMode('normal'), he: { ...HEBREW_PRESETS.normal, letter: { accept: 0.95, floor: 0.5 }, letterRecoveryMax: 0 } };
    expect(evaluate(he.items.find((i) => i.display === 'מ')!, say('אם'), configForMode('normal')).outcome).toBe('correct');
    expect(evaluate(he.items.find((i) => i.display === 'מ')!, say('אם'), picky).outcome).not.toBe('correct');
  });

  it('English evaluation is unchanged by the Hebrew layer', () => {
    expect(evaluate(item(en, 'en:word:cat'), say('cat'), configForMode('lenient')).outcome).toBe('correct');
    expect(evaluate(item(en, 'en:word:cat'), say('cap'), configForMode('lenient')).outcome).toBe('incorrect');
    expect(evaluate(item(en, 'en:letter:b'), say('dee'), configForMode('lenient')).outcome).toBe('incorrect');
    expect(evaluate(item(en, 'en:word:cat'), say('hat')).outcome).toBe('incorrect');
  });
});
