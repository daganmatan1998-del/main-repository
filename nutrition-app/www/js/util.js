// Small DOM + formatting helpers shared by every screen.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// ---------- dates (all "day keys" are local calendar days, YYYY-MM-DD) ----------

export function dayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Whole days since epoch for a day key; immune to DST because it goes through UTC.
export function dayNumber(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export function addDays(key, n) {
  const dn = dayNumber(key) + n;
  const d = new Date(dn * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function daysBetween(a, b) {
  return dayNumber(b) - dayNumber(a);
}

const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export function weekdayName(key) {
  const d = new Date(dayNumber(key) * 86400000);
  return HE_DAYS[d.getUTCDay()];
}

export function fmtDate(key, withYear = false) {
  const [y, m, d] = key.split('-');
  return withYear ? `${Number(d)}.${Number(m)}.${y}` : `${Number(d)}.${Number(m)}`;
}

// ---------- numbers ----------

export function round(n, step = 1) {
  return Math.round(n / step) * step;
}

export function fmt(n, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('he-IL', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function signed(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const r = Number(n.toFixed(digits));
  if (r === 0) return '0';
  return (r > 0 ? '+' : '−') + fmt(Math.abs(r), digits);
}

// Signed numbers and "a → b" inside Hebrew text: isolate them left-to-right so
// the minus sign and the arrow stay where they belong.
export function ltr(text, cls = 'num') {
  const span = document.createElement('span');
  span.dir = 'ltr';
  span.className = `ltr ${cls}`;
  span.textContent = text;
  return span;
}

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

// Deterministic PRNG so a given day's menu is stable across reloads.
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------- UI primitives ----------

let toastTimer;
export function toast(msg, ms = 2600) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// Bottom sheet. Returns { el, close }. Content is a node or a builder(close) -> node.
export function sheet(title, content, { onClose } = {}) {
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const close = () => {
    backdrop.classList.remove('open');
    setTimeout(() => backdrop.remove(), 220);
    document.removeEventListener('keydown', onKey);
    onClose && onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const body = typeof content === 'function' ? content(close) : content;
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-head' },
      h('h2', null, title),
      h('button', { class: 'icon-btn', 'aria-label': 'סגירה', onclick: close }, icon('close'))),
    h('div', { class: 'sheet-body' }, body));
  backdrop.appendChild(panel);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('open'));
  return { el: panel, close };
}

export function confirmDialog(title, text, okLabel = 'אישור', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const s = sheet(title, (close) => h('div', null,
      h('p', { class: 'muted' }, text),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), onclick: () => { done = true; resolve(true); close(); } }, okLabel),
        h('button', { class: 'btn btn-ghost', onclick: () => close() }, 'ביטול'))),
      { onClose: () => { if (!done) resolve(false); } });
    return s;
  });
}

// Inline SVG icon set (stroke icons, currentColor) — no icon font, works offline.
const ICONS = {
  today: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  plan: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  gallery: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  swap: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>',
  shuffle: '<path d="M4 7h3c4 0 6 10 10 10h3M4 17h3c1.5 0 2.7-1.4 3.7-3M14 9.5C15 8 16 7 17 7h3M18 4l3 3-3 3M18 14l3 3-3 3"/>',
  send: '<path d="M20 4 3 11l7 2 2 7z"/><path d="m10 13 4-4"/>',
  back: '<path d="m9 6 6 6-6 6"/>',
  forward: '<path d="m15 6-6 6 6 6"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  compare: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 2v20"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  download: '<path d="M12 4v11m-4-4 4 4 4-4M5 20h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  offline: '<path d="M2 8.8a15 15 0 0 1 4.2-2.7M22 8.8a15 15 0 0 0-9.7-3.7M5 12.5a10 10 0 0 1 3.2-2M19 12.5a10 10 0 0 0-3-2M8.5 16a5 5 0 0 1 7 0M12 20h.01M3 3l18 18"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
};

export function icon(name, size = 22) {
  const span = document.createElement('span');
  span.className = 'ic';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}

// Numeric input that accepts both "72.5" and "72,5".
export function parseNum(v) {
  if (v === null || v === undefined) return NaN;
  const s = String(v).trim().replace(',', '.');
  if (s === '') return NaN;
  return Number(s);
}
