// Reads the message syntax of www/js/i18n.js ({0}, {name}, plural, select) well
// enough to compare a translation with its English original.

// -> { vars: Set<string>, plurals: [{ name, cases: string[], nested }], problems: string[] }
export function analyze(msg) {
  const out = { vars: new Set(), plurals: [], selects: [], problems: [] };
  parse(msg, out, 0);
  return out;
}

function closing(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth += 1;
    else if (s[i] === '}') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

function parse(s, out) {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '}') { out.problems.push('unmatched }'); continue; }
    if (s[i] !== '{') continue;
    const end = closing(s, i);
    if (end < 0) { out.problems.push('unclosed {'); return; }
    const body = s.slice(i + 1, end);
    const a = body.indexOf(',');
    if (a < 0) {
      const name = body.trim();
      if (!/^[A-Za-z0-9_]+$/.test(name)) out.problems.push(`bad placeholder {${body}}`);
      else out.vars.add(name);
    } else {
      const name = body.slice(0, a).trim();
      const rest = body.slice(a + 1);
      const b = rest.indexOf(',');
      const kind = b < 0 ? rest.trim() : rest.slice(0, b).trim();
      const list = b < 0 ? '' : rest.slice(b + 1);
      out.vars.add(name);
      if (kind !== 'plural' && kind !== 'select') { out.problems.push(`unknown type "${kind}"`); i = end; continue; }
      const cases = [];
      for (let j = 0; j < list.length; j++) {
        if (/\s/.test(list[j])) continue;
        const open = list.indexOf('{', j);
        if (open < 0) { if (list.slice(j).trim()) out.problems.push('text outside a case'); break; }
        const sel = list.slice(j, open).trim();
        const e2 = closing(list, open);
        if (e2 < 0) { out.problems.push('unclosed case'); break; }
        if (!sel) out.problems.push('case without a selector');
        cases.push(sel);
        parse(list.slice(open + 1, e2), out);
        j = e2;
      }
      if (!cases.includes('other')) out.problems.push(`${kind} on {${name}} has no "other"`);
      (kind === 'plural' ? out.plurals : out.selects).push({ name, cases });
    }
    i = end;
  }
}

// The plural categories a language needs for whole numbers (CLDR).
// Only the forms that whole numbers up to 200 use: Spanish, French, Italian and
// Portuguese also have a "many" form, but only for millions.
export function pluralCategories(locale) {
  const r = new Intl.PluralRules(locale);
  const out = new Set();
  for (let n = 0; n <= 200; n++) out.add(r.select(n));
  return [...out];
}

// The words a reader sees: text outside placeholders and inside every plural /
// select branch, with the placeholders removed.
export function texts(msg) {
  const out = [];
  const walkText = (s) => {
    let buf = '';
    for (let i = 0; i < s.length; i++) {
      if (s[i] !== '{') { buf += s[i]; continue; }
      const end = closing(s, i);
      if (end < 0) { buf += s.slice(i); break; }
      out.push(buf); buf = '';
      const body = s.slice(i + 1, end);
      const a = body.indexOf(',');
      if (a >= 0) {
        const rest = body.slice(a + 1);
        const b = rest.indexOf(',');
        const list = b < 0 ? '' : rest.slice(b + 1);
        for (let j = 0; j < list.length; j++) {
          const open = list.indexOf('{', j);
          if (open < 0) break;
          const e2 = closing(list, open);
          if (e2 < 0) break;
          walkText(list.slice(open + 1, e2));
          j = e2;
        }
      }
      i = end;
    }
    out.push(buf);
  };
  walkText(msg);
  return out.filter((x) => x.trim());
}
