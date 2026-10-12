// Translation. English is the source language: every user-visible text in the
// code is an English message, `t('Save')`. A language pack (lang/<code>.js)
// maps those messages to its own language, and carries the data overlays
// (food names, recipe wording, shopping aisles …) by id. A message with no
// translation shows in English, never as a key or an empty string.
//
// Messages may hold placeholders: {0}, {1} (positional) or {name} (when the
// first argument is an object), and the ICU subset languages need for counts:
//   {n, plural, one {# day} other {# days}}   (# is the number; =0 / =1 allowed)
//   {x, select, a {…} b {…} other {…}}
// A message key may end with ‖context to tell two identical English words
// apart (`t('Back‖navigation')` shows "Back"); translators see the context.
//
// The language is read once at start (a module-level await), so every other
// module can call t() while it loads. Changing language saves the choice and
// reloads the page.

export const LANGS = [
  { code: 'en', name: 'English', dir: 'ltr', locale: 'en-US' },
  { code: 'he', name: 'עברית', dir: 'rtl', locale: 'he-IL' },
];

const KEY = 'nutri-lang';
const known = (c) => LANGS.some((l) => l.code === c);

function chosen() {
  try {
    if (globalThis.NUTRI_LANG && known(globalThis.NUTRI_LANG)) return globalThis.NUTRI_LANG; // tests
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lang') : null;
    if (q && known(q)) { localStorage.setItem(KEY, q); return q; }
    const saved = localStorage.getItem(KEY);
    if (saved && known(saved)) return saved;
  } catch { /* storage unavailable: English */ }
  return 'en';
}

export const lang = chosen();
const meta = LANGS.find((l) => l.code === lang);
export const dir = meta.dir;
export const locale = meta.locale;
export const isRTL = dir === 'rtl';
// German and a few others write every noun with a capital: never lowercase a name inside a sentence.
export const capitalNouns = meta.capitalNouns === true;

const EMPTY = { ui: {}, data: {} };
let pack = EMPTY;
if (lang !== 'en') {
  try {
    pack = (await import(`./lang/${lang}.js`)).default || EMPTY;
    // `fn`: texts a pack writes as functions (grammar no template can express).
    if (pack.fn) pack = { ...pack, ui: { ...pack.ui, ...pack.fn } };
  } catch (e) {
    console.warn(`language pack ${lang} failed to load; showing English`, e);
  }
}

if (typeof document !== 'undefined') {
  document.documentElement.lang = lang;
  document.documentElement.dir = dir;
}

// ---------- messages ----------

const stripContext = (s) => { const i = s.indexOf('‖'); return i < 0 ? s : s.slice(0, i); };

export function t(message, ...args) {
  if (typeof message !== 'string') return '';
  const tpl = pack.ui[message] !== undefined ? pack.ui[message] : stripContext(message);
  // A pack may hold a function for the rare text whose grammar no template can
  // express (Hebrew prefixes that merge with an article, for instance).
  return typeof tpl === 'function' ? tpl(...args) : format(tpl, args);
}

// Search words and synonyms: one message holding variants separated by '|'.
export const trl = (message) => t(message).split('|').filter(Boolean);

// The message in the active language without filling placeholders (for tests and tooling).
export const raw = (message) => (pack.ui[message] !== undefined && typeof pack.ui[message] === 'string' ? pack.ui[message] : stripContext(message));

// Data overlay of the active language: names and wording by id, for the data
// modules (foods, recipes, shopping …). Empty for English, the base language.
export const overlay = (section) => (pack.data && pack.data[section]) || null;

const rules = new Map();
const pluralOf = (loc, n) => { if (!rules.has(loc)) rules.set(loc, new Intl.PluralRules(loc)); return rules.get(loc).select(n); };
const num = (n, loc) => Number(n).toLocaleString(loc, { maximumFractionDigits: 2 });

function closing(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth += 1;
    else if (s[i] === '}') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

function value(name, args) {
  if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])) return args[0][name];
  return args[Number(name)];
}

function render(s, args, loc, count) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') {
      const end = closing(s, i);
      if (end < 0) { out += s.slice(i); break; }
      out += expression(s.slice(i + 1, end), args, loc);
      i = end;
    } else if (c === '#' && count !== undefined) out += num(count, loc);
    else out += c;
  }
  return out;
}

function expression(body, args, loc) {
  const a = body.indexOf(',');
  if (a < 0) {
    const v = value(body.trim(), args);
    return v === undefined || v === null ? '' : String(v);
  }
  const name = body.slice(0, a).trim();
  const rest = body.slice(a + 1);
  const b = rest.indexOf(',');
  const kind = rest.slice(0, b).trim();
  const list = rest.slice(b + 1);
  const cases = {};
  for (let i = 0; i < list.length; i++) {
    if (/\s/.test(list[i])) continue;
    const open = list.indexOf('{', i);
    if (open < 0) break;
    const selector = list.slice(i, open).trim();
    const end = closing(list, open);
    if (end < 0) break;
    cases[selector] = list.slice(open + 1, end);
    i = end;
  }
  const v = value(name, args);
  if (kind === 'plural') {
    const n = Number(v);
    const form = pluralOf(loc, n);
    const pick = cases[`=${n}`] !== undefined ? cases[`=${n}`] : cases[form] !== undefined ? cases[form] : cases.other;
    return pick === undefined ? '' : render(pick, args, loc, n);
  }
  if (kind === 'select') {
    const pick = cases[String(v)] !== undefined ? cases[String(v)] : cases.other;
    return pick === undefined ? '' : render(pick, args, loc);
  }
  return '';
}

// loc: the locale whose plural rules apply (the active language by default).
export function format(tpl, args = [], loc = locale) {
  return tpl.includes('{') ? render(tpl, args, loc) : tpl;
}

// ---------- language choice ----------

export function setLanguage(code) {
  if (!known(code) || code === lang) return;
  try { localStorage.setItem(KEY, code); } catch { /* ignore */ }
  location.reload();
}

// Language-aware formatting.
export const fmtNumber = (n, digits = 0) => Number(n).toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
export const dateParts = (key, options) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options }).format(new Date(Date.UTC(y, m - 1, d)));
};
