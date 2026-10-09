import { describe, expect, it } from 'vitest';
import { getPack } from '../src/content/registry';
import { evaluate } from '../src/evaluation/evaluator';
import type { LearningItem } from '../src/content/types';

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
    expect(evaluate(w('בָּא'), say('אבא')).outcome).toBe('incorrect');
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
