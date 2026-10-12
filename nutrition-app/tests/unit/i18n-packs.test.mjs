// Every language pack must be complete and well-formed (tools/i18n/check.mjs
// without the spell check, which needs the dictionaries and is slower:
// `node tools/i18n/check.mjs`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { checkPack } from '../../tools/i18n/check.mjs';
import { LANGS } from '../../www/js/i18n.js';
import { LOCALES } from '../../tools/i18n/languages.mjs';

const dir = new URL('../../www/js/lang/', import.meta.url);
const packs = readdirSync(dir).filter((f) => /^[a-z]{2,3}\.js$/.test(f)).map((f) => f.slice(0, -3));

test('every offered language has a pack (English is the base and has none)', () => {
  const offered = LANGS.map((l) => l.code).filter((c) => c !== 'en').sort();
  assert.deepEqual(packs.sort(), offered);
});

test('the language list of the app and of the tools agree', () => {
  for (const l of LANGS) assert.equal(LOCALES[l.code], l.locale, l.code);
});

test('every pack is cached for offline use', () => {
  const sw = readFileSync(new URL('../../www/sw.js', import.meta.url), 'utf8');
  for (const code of packs) assert.ok(sw.includes(`'js/lang/${code}.js'`), `${code} missing from the service worker's SHELL`);
});

for (const code of packs) {
  test(`${code}: complete, placeholders and plurals intact, right script, no repeated words`, async () => {
    const r = await checkPack(code, { spell: false });
    assert.deepEqual(r.errors.slice(0, 5), [], `${r.errors.length} problems`);
  });
}
