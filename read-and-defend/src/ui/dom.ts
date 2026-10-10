/** Tiny DOM helpers and the SVG icon set (no emoji as icons). */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined> = {},
  ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') e.className = String(v);
    else if (k === 'html') e.innerHTML = String(v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

export function svg(markup: string, cls = ''): SVGElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  const s = t.content.firstElementChild as SVGElement;
  if (cls) s.setAttribute('class', cls);
  s.setAttribute('aria-hidden', 'true');
  return s;
}

const S = (inner: string, vb = '0 0 24 24') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

export const ICONS = {
  mic: S('<path fill="currentColor" d="M12 15a4 4 0 0 0 4-4V6a4 4 0 0 0-8 0v5a4 4 0 0 0 4 4Zm7-4a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.08A7 7 0 0 0 19 11Z"/>'),
  spinner: S('<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="42 20" stroke-linecap="round"/>'),
  speaker: S('<path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4Zm11.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4Zm-2.5-8.7v2.1a7 7 0 0 1 0 13.2v2.1a9 9 0 0 0 0-17.4Z"/>'),
  puzzle: S('<path fill="currentColor" d="M10 3a2 2 0 0 1 2 2v1h3a1 1 0 0 1 1 1v3h1a2 2 0 1 1 0 4h-1v3a1 1 0 0 1-1 1h-3v-1a2 2 0 1 0-4 0v1H5a1 1 0 0 1-1-1v-3h1a2 2 0 1 0 0-4H4V7a1 1 0 0 1 1-1h3V5a2 2 0 0 1 2-2Z"/>'),
  pause: S('<path fill="currentColor" d="M7 5h3v14H7zM14 5h3v14h-3z"/>'),
  download: S('<path fill="currentColor" d="M5 20h14v-2H5v2Zm7-3 6-6-1.4-1.4L13 13.2V4h-2v9.2L7.4 9.6 6 11l6 6Z"/>'),
  play: S('<path fill="currentColor" d="M8 5v14l11-7z"/>'),
  heart: S('<path fill="currentColor" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2 0 3.5 1.1 4.3 2.4.8-1.3 2.3-2.4 4.3-2.4 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21Z"/>'),
  heartEmpty: S('<path fill="none" stroke="currentColor" stroke-width="2" d="M12 19.8s-6.8-4.2-8.7-8.3C2 8.6 3.8 5.5 6.8 5.5c1.9 0 3.2 1.2 3.9 2.4L12 9.6l1.3-1.7c.7-1.2 2-2.4 3.9-2.4 3 0 4.8 3.1 3.5 6-1.9 4.1-8.7 8.3-8.7 8.3Z"/>'),
  star: S('<path fill="#ffc23d" stroke="#b07a00" stroke-width="1" d="m12 2.6 2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.2l-5.8 3.2 1.2-6.5-4.8-4.5 6.5-.8z"/>'),
  starEmpty: S('<path fill="#e6dcc6" stroke="#b5a98f" stroke-width="1" d="m12 2.6 2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.2l-5.8 3.2 1.2-6.5-4.8-4.5 6.5-.8z"/>'),
  lock: S('<path fill="currentColor" d="M7 10V8a5 5 0 0 1 10 0v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1Zm2 0h6V8a3 3 0 0 0-6 0v2Z"/>'),
  coin: S('<circle cx="12" cy="12" r="9" fill="#ffc23d" stroke="#c98a00" stroke-width="2"/><path d="M12 7v10M9.5 9.5h3.8a1.7 1.7 0 0 1 0 3.4h-2.6a1.7 1.7 0 0 0 0 3.4h3.8" fill="none" stroke="#8a5a00" stroke-width="1.6" stroke-linecap="round"/>'),
  spark: S('<path fill="#7ae7ff" stroke="#0b7285" stroke-width="1" d="M12 2l2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2z"/>'),
  map: S('<path fill="currentColor" d="m9 4 6 2 5-2v15l-5 2-6-2-5 2V6l5-2Zm1 2.3v11.4l4 1.3V7.6l-4-1.3Z"/>'),
  castle: S('<path fill="currentColor" d="M3 21V9h2V6h2v3h2V6h2v3h2V6h2v3h2V6h2v3h2v12h-7v-4a2 2 0 1 0-4 0v4H3Z"/>'),
  chart: S('<path fill="currentColor" d="M4 20V10h3v10H4Zm6 0V4h3v16h-3Zm6 0v-7h3v7h-3Z"/>'),
  gear: S('<path fill="currentColor" d="M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6ZM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" transform="translate(-1 0)"/>'),
  back: S('<path fill="currentColor" d="M15.5 4.5 8 12l7.5 7.5 1.5-1.5-6-6 6-6z"/>'),
  retry: S('<path fill="currentColor" d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z"/>'),
  check: S('<path fill="currentColor" d="m9.5 16.2-4-4L4 13.7l5.5 5.5L20 8.7l-1.5-1.5z"/>'),
  dot: S('<circle cx="12" cy="12" r="5" fill="currentColor"/>'),
  ring: S('<circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2.5"/>'),
  alert: S('<path fill="currentColor" d="M12 3 1.5 21h21L12 3Zm1 14h-2v-2h2v2Zm0-4h-2V9h2v4Z"/>'),
  book: S('<path fill="currentColor" d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5a1 1 0 0 0 0 2H20v1H6.5A2.5 2.5 0 0 1 4 19.5v-15Z"/>'),
  compass: S('<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path fill="currentColor" d="m15.5 8.5-2 5-5 2 2-5z"/>'),
  scroll: S('<path fill="currentColor" d="M6 3h11a3 3 0 0 1 3 3v1h-3v11a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-1h3V6a3 3 0 0 1 1-3Zm3 5v2h6V8H9Zm0 4v2h6v-2H9Z"/>'),
  crown: S('<path fill="currentColor" d="m3 7 4.5 4L12 4l4.5 7L21 7l-2 12H5L3 7Z"/>'),
  shield: S('<path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z"/>'),
  troll: S('<circle cx="12" cy="13" r="7" fill="currentColor"/><path fill="currentColor" d="M6 8 4 3l5 3zM18 8l2-5-5 3z"/>'),
  orb: S('<circle cx="12" cy="12" r="7" fill="#fff8d6"/><circle cx="12" cy="12" r="4.5" fill="currentColor"/><circle cx="10.5" cy="10.5" r="1.6" fill="#fff"/>'),
  arrow: S('<path d="M3 21 17 7" stroke="#5d4037" stroke-width="2.4" stroke-linecap="round"/><path fill="#eceff1" d="m21 3-7.5 2.2 5.3 5.3z"/><path fill="#e63946" d="M3 21l1-5 2 2zM3 21l5-1-2-2z"/>'),
  snow: S('<g stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"><path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7"/><path d="m9 4 3 3 3-3M9 20l3-3 3 3"/></g>'),
  flame: S('<path fill="#ffb703" d="M12 22c-4.4 0-7-3-7-6.8C5 10.7 9.6 8 9.6 3c3.7 2 4.4 5.2 4 7.4 1-.6 1.8-1.8 2-3.2 2.4 2 3.4 4.8 3.4 8C19 19 16.4 22 12 22Z"/><path fill="#fff3b0" d="M12 21c-2 0-3.3-1.3-3.3-3.2 0-2.3 2.1-3.4 2.4-5.8 2.4 1.5 4.2 3.4 4.2 5.8 0 1.9-1.3 3.2-3.3 3.2Z"/>'),
  bomb: S('<circle cx="11" cy="14" r="7" fill="currentColor"/><circle cx="8.5" cy="11.5" r="1.8" fill="#fff" opacity=".6"/><path d="M15.5 8.5 18 6" stroke="#8d6e63" stroke-width="2"/><path fill="#ffb703" d="m19 2 .9 2.1L22 5l-2.1.9L19 8l-.9-2.1L16 5l2.1-.9z"/>'),
  bolt: S('<path fill="#fff59d" stroke="#f9a825" stroke-width="1" d="M13.5 2 5 13.5h5.5L9 22l9.5-12.5H13z"/>'),
  stars: S('<path fill="#ffd166" d="m8 2 1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5z"/><path fill="#ff8fab" d="m17 10 1.2 2.5 2.8.4-2 1.9.5 2.8-2.5-1.3-2.5 1.3.5-2.8-2-1.9 2.8-.4z"/><path fill="#7ae7ff" d="m10 16 .8 1.7 1.9.3-1.4 1.3.3 1.9-1.6-.9-1.7.9.4-1.9-1.4-1.3 1.9-.3z"/>'),
  monster: S('<path fill="#2bb673" d="M3 20c0-8 4-13 9-13s9 5 9 13H3Z"/><circle cx="9.5" cy="13" r="2" fill="#fff"/><circle cx="14.5" cy="13" r="2" fill="#fff"/><circle cx="10" cy="13.3" r="1" fill="#1d1d2b"/><circle cx="15" cy="13.3" r="1" fill="#1d1d2b"/>'),
};

export function icon(name: keyof typeof ICONS, cls = ''): SVGElement {
  return svg(ICONS[name], cls);
}

export function starsRow(n: number, max = 3): HTMLElement {
  const row = el('span', { class: 'stars', role: 'img', 'aria-label': `${n} / ${max}` });
  for (let i = 0; i < max; i++) row.append(icon(i < n ? 'star' : 'starEmpty', i < n ? 'earned' : ''));
  return row;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, kind: '' | 'good' = '', ms = 1800): void {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = text;
  t.className = `show ${kind}`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, ms);
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}
