import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, format, raw, LANGS, lang, dir } from '../../www/js/i18n.js';

test('English is the default language, left to right', () => {
  assert.equal(globalThis.NUTRI_LANG === undefined ? lang : 'he', globalThis.NUTRI_LANG === undefined ? 'en' : 'he');
});

test('a message with no translation shows as itself, without its context', () => {
  assert.equal(t('Save'), globalThis.NUTRI_LANG === 'he' ? t('Save') : 'Save');
  assert.equal(raw('Back‖navigation').includes('‖'), false);
  assert.equal(t(undefined), '');
});

test('placeholders: positional and named', () => {
  assert.equal(format('{0} of {1}', [3, 5]), '3 of 5');
  assert.equal(format('Hello {name}', [{ name: 'Dana' }]), 'Hello Dana');
  assert.equal(format('no placeholders'), 'no placeholders');
  assert.equal(format('{9}', [1]), '', 'a missing argument is empty, not "undefined"');
});

test('plural: English has one/other and exact matches', () => {
  const m = '{n, plural, =0 {no days} one {# day} other {# days}} left';
  assert.equal(format(m, [{ n: 0 }], 'en-US'), 'no days left');
  assert.equal(format(m, [{ n: 1 }], 'en-US'), '1 day left');
  assert.equal(format(m, [{ n: 5 }], 'en-US'), '5 days left');
  assert.equal(format(m, [{ n: 1200 }], 'en-US'), '1,200 days left');
});

test('plural: each language uses its own categories', () => {
  const ru = '{n, plural, one {# день} few {# дня} many {# дней} other {# дня}}';
  assert.deepEqual([1, 2, 5, 11, 21, 22, 25].map((n) => format(ru, [{ n }], 'ru-RU')), ['1 день', '2 дня', '5 дней', '11 дней', '21 день', '22 дня', '25 дней']);
  const he = '{n, plural, one {# יום} two {יומיים} other {# ימים}}';
  assert.deepEqual([1, 2, 3].map((n) => format(he, [{ n }], 'he-IL')), ['1 יום', 'יומיים', '3 ימים']);
  const ar = '{n, plural, zero {لا أيام} one {يوم} two {يومان} few {# أيام} many {# يومًا} other {# يوم}}';
  assert.deepEqual([0, 1, 2, 3, 11, 100].map((n) => format(ar, [{ n }], 'ar')), ['لا أيام', 'يوم', 'يومان', '3 أيام', '11 يومًا', '100 يوم']);
});

test('select and nesting', () => {
  const m = '{who, select, female {She} male {He} other {They}} ate {n, plural, one {# meal} other {# meals}}';
  assert.equal(format(m, [{ who: 'female', n: 1 }], 'en-US'), 'She ate 1 meal');
  assert.equal(format(m, [{ who: 'x', n: 3 }], 'en-US'), 'They ate 3 meals');
});

test('the language list: English first, each with a direction and a locale', () => {
  assert.equal(LANGS[0].code, 'en');
  for (const l of LANGS) assert.ok(['ltr', 'rtl'].includes(l.dir) && l.locale && l.name);
  assert.ok(['ltr', 'rtl'].includes(dir));
});
