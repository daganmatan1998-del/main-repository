// Quality gate for a language pack. Run it on every pack before shipping:
//
//   node tools/i18n/check.mjs            every pack
//   node tools/i18n/check.mjs es fr      some
//   node tools/i18n/check.mjs --no-spell skip the spell check (fast)
//
// It reports ERRORS (the pack must not ship) and WARNINGS (a person should
// look). Spelling is checked with Hunspell dictionaries where one exists;
// words a dictionary doesn't know but that are right (brand names, loanwords)
// go in tools/i18n/words/<lang>.txt, one per line.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { usedKeys, english, ROOT } from './keys.mjs';
import { analyze, pluralCategories, texts } from './icu.mjs';

const LANG_DIR = path.join(ROOT, 'www/js/lang');

// Latin tokens that may stand inside any script (units, brands, nutrition letters).
const LATIN_OK = new Set(['nutri', 'g', 'kg', 'kcal', 'cm', 'ml', 'l', 'p', 'c', 'f', 'xl', 'l', 'm', 'google', 'paypal', 'apple', 'pay', 'pro', 'plus', 'ok', 'ics', 'pdf', 'whatsapp', 'bmi', 'ai', 'usb', 'wi', 'fi', 'iphone', 'android', 'chrome', 'safari', 'jpeg', 'jpg', 'png', 'a', 'b', 'c', 'd', 'e', 'x', 'omega', 'ph', 'id', 'tv', 'ph', 'dna', 'goldstar', 'malka', 'prigat', 'primor', 'schweppes', 'tnuva', 'danonino', 'coca', 'cola', 'pepsi', 'sprite', 'fanta', 'red', 'bull', 'monster', 'gatorade', 'powerade', 'wasa', 'quaker', 'tabasco', 'sriracha', 'teriyaki', 'tzatziki', 'pesto', 'hummus', 'tahini', 'labneh', 'shawarma', 'harissa', 'hawaij', 'zaatar', 'za', 'atar', 'freekeh', 'ptitim', 'seitan', 'tempeh', 'edamame', 'skyr', 'quark', 'ghee', 'dijon', 'parmesan', 'cheddar', 'feta', 'mozzarella', 'chraime', 'majadra', 'mujaddara', 'latte', 'cappuccino', 'espresso', 'americano', 'hafuch', 'shatta', 'mi', 'dc', 'mb', 'dexa', 'katch', 'mcardle', 'kj', 'mg', 'mm', 'wi', 'fi', 'gb']);

const SCRIPT = {
  latin: /\p{Script=Latin}/u, hebrew: /\p{Script=Hebrew}/u, arabic: /\p{Script=Arabic}/u, cyrillic: /\p{Script=Cyrillic}/u, greek: /\p{Script=Greek}/u,
  devanagari: /\p{Script=Devanagari}/u, thai: /\p{Script=Thai}/u, hangul: /\p{Script=Hangul}/u, kana: /[\p{Script=Hiragana}\p{Script=Katakana}]/u, han: /\p{Script=Han}/u,
};
const OWN = { he: ['hebrew'], ar: ['arabic'], fa: ['arabic'], ru: ['cyrillic'], uk: ['cyrillic'], bg: ['cyrillic'], el: ['greek'], hi: ['devanagari'], th: ['thai'], ko: ['hangul'], ja: ['kana', 'han'], zh: ['han'] };
const ownScripts = (lang) => OWN[lang] || ['latin'];
const NONLATIN = (lang) => (OWN[lang] || []).length > 0;
const SPELL = new Set(['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'tr', 'nl', 'pl', 'uk', 'cs', 'el', 'hu', 'ro', 'sv', 'he', 'vi', 'bg', 'da', 'ko']);

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#')) : []);

export async function speller(lang) {
  if (!SPELL.has(lang)) return null;
  const nspell = (await import('nspell')).default;
  const dict = (await import(`dictionary-${lang}`)).default;
  const sp = nspell(dict);
  for (const w of read(path.join(ROOT, `tools/i18n/words/${lang}.txt`))) sp.add(w);
  for (const w of read(path.join(ROOT, 'tools/i18n/words/all.txt'))) sp.add(w);
  return sp;
}

const WORD = /[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*/gu;

export function misspelled(sp, lang, value) {
  const bad = [];
  for (const piece of texts(value)) {
    for (const [word] of piece.matchAll(WORD)) {
      if (word.length < 2) continue;
      const parts = [word, ...word.split(/['’\-]/)].filter(Boolean);
      // A word is fine if the whole thing or all of its parts are known.
      const known = (w) => sp.correct(w) || sp.correct(w.toLowerCase()) || sp.correct(w[0].toUpperCase() + w.slice(1).toLowerCase());
      if (known(word)) continue;
      const split = word.split(/['’\-]/).filter(Boolean);
      if (split.length > 1 && split.every((w) => w.length < 2 || known(w))) continue;
      bad.push(word);
    }
  }
  return bad;
}

const endMark = (s) => {
  const t = s.trimEnd().slice(-1);
  if ('.。।۔'.includes(t)) return '.';
  if ('?？؟'.includes(t)) return '?';
  if ('!！'.includes(t)) return '!';
  if (':：'.includes(t)) return ':';
  if (t === '…') return '…';
  if (')）'.includes(t)) return ')';
  return '';
};

export async function checkPack(lang, { spell = true } = {}) {
  const errors = [];
  const warnings = [];
  // Hebrew is the app's original language, written before these rules: its grammar
  // (prefix letters, plain plurals) is reviewed by hand, so some rules only warn.
  const legacy = lang === 'he';
  const pack = (await import(pathToFileURL(path.join(LANG_DIR, `${lang}.js`)).href)).default;
  const ui = { ...pack.ui, ...(pack.fn || {}) };
  const { keys } = usedKeys();
  const locale = (await import(pathToFileURL(path.join(ROOT, 'tools/i18n/languages.mjs')).href)).LOCALES[lang] || lang;
  const sp = spell ? await speller(lang) : null;
  // Repeats that are correct grammar (French "vous vous connectez", German "das das"…): one word per line.
  const repeatOk = new Set(read(path.join(ROOT, `tools/i18n/repeat-ok/${lang}.txt`)));
  const sameOk = new Set(read(path.join(ROOT, `tools/i18n/same-ok/${lang}.txt`)));
  const cats = pluralCategories(locale);
  const own = ownScripts(lang);

  for (const [key, meta] of keys) {
    const en = english(key);
    const v = ui[key];
    const at = `${JSON.stringify(key)}`;
    if (v === undefined) { errors.push(`missing: ${at}`); continue; }
    if (typeof v === 'function') continue; // hand-written grammar: reviewed by a person
    if (typeof v !== 'string' || !v.trim()) { errors.push(`empty: ${at}`); continue; }

    // --- structure ---
    const a = analyze(en);
    const b = analyze(v);
    if (b.problems.length) errors.push(`syntax (${b.problems.join('; ')}): ${at} -> ${JSON.stringify(v)}`);
    const missingVars = [...a.vars].filter((x) => !b.vars.has(x));
    const extraVars = [...b.vars].filter((x) => !a.vars.has(x));
    if (missingVars.length || extraVars.length) errors.push(`placeholders (missing ${missingVars.join(',') || '-'}, extra ${extraVars.join(',') || '-'}): ${at} -> ${JSON.stringify(v)}`);
    for (const p of b.plurals) {
      const need = cats.filter((c) => !p.cases.includes(c) && !p.cases.includes('other'));
      const missing = cats.filter((c) => !p.cases.includes(c));
      if (missing.length && !need.length) {
        // "other" covers it; fine unless the language really distinguishes the form
        if (!legacy && cats.length > 2 && missing.filter((c) => c !== 'other').length > 0 && !p.cases.some((c) => c.startsWith('='))) warnings.push(`plural forms (${missing.join(',')} fall to "other"): ${at} -> ${JSON.stringify(v)}`);
      }
    }
    for (const p of a.plurals) if (!b.plurals.some((x) => x.name === p.name)) (legacy ? warnings : errors).push(`plural dropped for {${p.name}}: ${at} -> ${JSON.stringify(v)}`);
    if (/^\s/.test(en) !== /^\s/.test(v) || /\s$/.test(en) !== /\s$/.test(v)) (legacy ? warnings : errors).push(`edge whitespace differs from the English: ${at} -> ${JSON.stringify(v)}`);
    if ((en.match(/\n/g) || []).length !== (v.match(/\n/g) || []).length) errors.push(`line breaks differ: ${at}`);
    if (/ {2,}/.test(v.trim())) errors.push(`double space: ${at} -> ${JSON.stringify(v)}`);
    if (meta.kind !== 'trl' && v.includes('|') && !en.includes('|')) errors.push(`"|" is only for search words (a list): ${at}`);
    if (meta.kind === 'trl' && v.split('|').some((x) => !x.trim())) errors.push(`empty search word: ${at} -> ${JSON.stringify(v)}`);

    // --- scripts ---
    const letters = (s) => /\p{L}/u.test(s);
    const sameAsEnglish = v === en;
    if (sameAsEnglish && letters(en) && !sameOk.has(en.toLowerCase()) && !/^[\p{Lu}\d\s.,:;()%/·—–-]+$/u.test(en)) {
      (NONLATIN(lang) ? errors : warnings).push(`not translated (same as English): ${at}`);
    }
    for (const token of texts(v).join(' ').matchAll(/[\p{L}\p{M}]+/gu)) {
      const w = token[0];
      const scripts = Object.entries(SCRIPT).filter(([, re]) => re.test(w)).map(([n]) => n);
      if (scripts.length > 1 && !(scripts.length === 2 && scripts.includes('kana') && scripts.includes('han'))) errors.push(`mixed scripts in the word "${w}" (${scripts.join('+')}): ${at}`);
      for (const s of scripts) {
        if (own.includes(s)) continue;
        if (s === 'latin' && (LATIN_OK.has(w.toLowerCase()) || sameOk.has(w.toLowerCase()))) continue;
        if (s === 'latin' && NONLATIN(lang)) errors.push(`Latin word "${w}" in a ${own.join('/')} text: ${at} -> ${JSON.stringify(v)}`);
        else if (s !== 'latin') errors.push(`word "${w}" is in ${s}, not ${own.join('/')}: ${at}`);
      }
    }

    // --- repeats ---
    for (const t of texts(v)) {
      for (const seg of t.toLocaleLowerCase().split(/[,.;:!?()«»"“”„‘’¡¿—–|·•،؛。、]+/)) {
        const words = seg.split(/\s+/).filter(Boolean);
        for (let i = 1; i < words.length; i++) {
          if (words[i] === words[i - 1] && words[i].length > 1 && !/^[\d.,/%+−-]+$/.test(words[i]) && !repeatOk.has(words[i])) errors.push(`repeated word "${words[i]}": ${at} -> ${JSON.stringify(v)}`);
        }
      }
    }

    // --- punctuation and length ---
    const e1 = endMark(en); const e2 = endMark(v);
    if (e1 !== e2 && meta.kind !== 'trl') warnings.push(`ends differently (${e1 || 'none'} vs ${e2 || 'none'}): ${at} -> ${JSON.stringify(v)}`);
    if (v.length > en.length * 2.4 + 12 && !/[぀-鿿가-힯]/.test(v)) warnings.push(`much longer than the English (${v.length} vs ${en.length}): ${at}`);
    if (/\p{Lu}/u.test(en[0] || '') && ownScripts(lang).includes('latin') && /\p{Ll}/u.test(v[0] || '') && lang !== 'de' && meta.kind !== 'trl' && !/^[a-z]/.test(en)) warnings.push(`starts lowercase, English starts uppercase: ${at} -> ${JSON.stringify(v)}`);

    // --- spelling ---
    // Search words are matched, not read: variants without accents or in a second spelling are there on purpose.
    if (sp && meta.kind !== 'trl') {
      const bad = misspelled(sp, lang, v);
      if (bad.length) errors.push(`spelling (${[...new Set(bad)].join(', ')}): ${at} -> ${JSON.stringify(v)}`);
    }
  }
  const extra = Object.keys(ui).filter((k) => !keys.has(k));
  if (extra.length) warnings.push(`${extra.length} unused keys (e.g. ${JSON.stringify(extra.slice(0, 3))})`);
  return { errors, warnings, total: keys.size };
}

// ---------- CLI ----------
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const spell = !args.includes('--no-spell');
  const only = args.filter((a) => !a.startsWith('--'));
  const langs = only.length ? only : readdirSync(LANG_DIR).filter((f) => /^[a-z]{2,3}\.js$/.test(f)).map((f) => f.slice(0, -3));
  let bad = 0;
  for (const lang of langs) {
    const r = await checkPack(lang, { spell });
    console.log(`\n== ${lang}: ${r.total} messages, ${r.errors.length} errors, ${r.warnings.length} warnings`);
    for (const e of r.errors.slice(0, 400)) console.log('  ERROR  ' + e);
    for (const w of r.warnings.slice(0, 60)) console.log('  warn   ' + w);
    if (r.errors.length) bad += 1;
  }
  process.exit(bad ? 1 : 0);
}
