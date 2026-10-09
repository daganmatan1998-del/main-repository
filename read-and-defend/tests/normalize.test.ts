import { describe, expect, it } from 'vitest';
import { englishSoundAlikes, hebrewReadingRegex, normalizeEnglish, normalizeHebrew } from '../src/evaluation/normalize';
import { phonetic, plene, stripNiqqud } from '../src/content/hebrew/script';

describe('English normalisation', () => {
  it('lowercases, strips punctuation and expands digits', () => {
    expect(normalizeEnglish('  The CAT, is on the bed! ')).toBe('the cat is on the bed');
    expect(normalizeEnglish('6')).toBe('six');
    expect(normalizeEnglish('It’s a dog.')).toBe("it's a dog");
  });
  it('knows homophones a recogniser cannot tell apart', () => {
    expect(englishSoundAlikes('sun').has('son')).toBe(true);
    expect(englishSoundAlikes('see').has('sea')).toBe(true);
    expect(englishSoundAlikes('cat').has('cap')).toBe(false);
  });
});

describe('Hebrew normalisation', () => {
  it('strips niqqud and normalises final letters', () => {
    expect(stripNiqqud('שָׁלוֹם')).toBe('שלום');
    expect(normalizeHebrew('שָׁלוֹם!')).toBe('שלומ');
    expect(normalizeHebrew('דָּג')).toBe(normalizeHebrew('דג'));
  });
  it('derives Modern Hebrew phonetics from pointed text', () => {
    expect(phonetic('דָּג')).toBe('dag');
    expect(phonetic('שָׁלוֹם')).toBe('shalom');
    expect(phonetic('בַּיִת')).toBe('bayit');
    expect(phonetic('תַּפּוּחַ')).toBe('tapuakh'); // patah genuva
    expect(phonetic('כֶּלֶב')).toBe('kelev');      // dagesh decides k/kh, b/v
    expect(phonetic('שָׂדֶה')).toBe('sade');       // sin dot, silent final he
    expect(phonetic('בָּ')).toBe('ba');
    expect(phonetic('בּוֹ')).toBe('bo');
    expect(phonetic('בִּ')).toBe('bi');
  });
  it('derives standard plene spelling', () => {
    expect(plene('כִּתָּה')).toBe('כיתה');
    expect(plene('מִכְתָּב')).toBe('מכתב');
    expect(plene('שֻׁלְחָן')).toBe('שולחן');
    expect(plene('דֹּב')).toBe('דוב');
    expect(plene('בַּיִת')).toBe('בית');
    expect(plene('עִם')).toBe('עם');
  });
  it('builds a reading regex that respects vowel letters', () => {
    expect(hebrewReadingRegex('בא').test('ba')).toBe(true);
    expect(hebrewReadingRegex('בא').test('bi')).toBe(false);
    expect(hebrewReadingRegex('בי').test('bi')).toBe(true);
    expect(hebrewReadingRegex('בו').test('bo')).toBe(true);
    expect(hebrewReadingRegex('ספר').test('sefer')).toBe(true);
    expect(hebrewReadingRegex('גור').test('gir')).toBe(false);
  });
});
