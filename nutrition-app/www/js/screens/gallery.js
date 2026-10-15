// Progress gallery: one slot per week since registration, full-screen viewer,
// and a before/after compare view with a slider.
// There is deliberately no per-photo delete: removing a week's photo would
// re-open (or dodge) the weekly requirement. Deleting everything lives in Profile.

import { t as tr } from '../i18n.js';
import { h, icon, clear, fmt, fmtDate, ltr } from '../util.js';
import { slots, getPhoto } from '../store.js';

export function renderGallery(root) {
  const urls = new Map(); // photoId -> object URL
  const urlFor = async (photoId) => {
    if (urls.has(photoId)) return urls.get(photoId);
    const p = await getPhoto(photoId);
    if (!p) return null;
    const u = URL.createObjectURL(p.blob);
    urls.set(photoId, u);
    return u;
  };

  const all = slots();
  const withPhotos = all.filter((s) => s.checkin);

  root.appendChild(h('header', { class: 'page-head' },
    h('div', null, h('h1', null, tr('Progress gallery')), h('p', { class: 'muted' }, tr('{0} photos · {1} weeks', withPhotos.length, all.length))),
    withPhotos.length >= 2 ? h('button', { class: 'btn btn-small', id: 'btn-compare', onclick: () => openCompare(withPhotos, urlFor) }, icon('compare', 18), tr('Compare')) : null));

  const grid = h('div', { class: 'gallery-grid' });
  for (const s of all) {
    const c = s.checkin;
    const tile = h('button', {
      class: 'tile' + (c ? '' : ' empty'),
      'aria-label': c ? tr('Week {0}, {1}', s.week, fmtDate(s.date)) : tr('Week {0} — no photo', s.week),
      disabled: !c,
      onclick: c ? () => openViewer(withPhotos, withPhotos.indexOf(s), urlFor) : null,
    });
    const frame = h('div', { class: 'tile-img' });
    if (c) {
      urlFor(c.photoId).then((u) => {
        // A week photographed on another device, with photo backup off.
        frame.appendChild(u ? h('img', { src: u, alt: '', loading: 'lazy' }) : h('span', { class: 'missing' }, icon('lock', 22), tr('On another device')));
      });
    } else {
      frame.appendChild(h('span', { class: 'missing' }, icon('camera', 26), tr('No photo')));
    }
    tile.append(frame, h('div', { class: 'tile-cap' },
      h('b', null, s.week === 0 ? tr('Start‖week 0') : tr('Week {0}', s.week)),
      h('span', { class: 'muted num' }, fmtDate(s.date)),
      c && c.weight ? h('span', { class: 'num' }, tr('{0} kg · {1}%', fmt(c.weight, 1), c.bf ?? '—')) : h('span', { class: 'muted' }, '—')));
    grid.appendChild(tile);
  }
  root.appendChild(grid);
  root.appendChild(h('p', { class: 'muted small center' }, icon('lock', 14), tr(' Photos are saved only on this device and are not sent to any server.')));

  return () => { for (const u of urls.values()) URL.revokeObjectURL(u); };
}

function overlay(cls, label) {
  const el = h('div', { class: `overlay ${cls}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': label });
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey); window.removeEventListener('hashchange', close); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', close);
  document.body.appendChild(el);
  return { el, close };
}

function caption(s) {
  const c = s.checkin;
  return `${s.week === 0 ? tr('Start‖week 0') : tr('Week {0}', s.week)} · ${fmtDate(s.date, true)}${c.weight ? tr(' · {0} kg · {1}%', fmt(c.weight, 1), c.bf) : ''}`;
}

function openViewer(list, index, urlFor) {
  const { el, close } = overlay('viewer', tr('Full-screen photo'));
  let i = index;
  const img = h('img', { alt: '' });
  const cap = h('div', { class: 'viewer-cap num' });
  const show = async () => {
    img.src = (await urlFor(list[i].checkin.photoId)) || '';
    img.alt = caption(list[i]);
    cap.textContent = caption(list[i]);
    prev.disabled = i === 0;
    next.disabled = i === list.length - 1;
  };
  // RTL: "previous" (earlier week) sits on the right.
  const prev = h('button', { class: 'icon-btn nav prev', 'aria-label': tr('Previous week'), onclick: () => { if (i > 0) { i--; show(); } } }, icon('back', 26));
  const next = h('button', { class: 'icon-btn nav next', 'aria-label': tr('Next week'), onclick: () => { if (i < list.length - 1) { i++; show(); } } }, icon('forward', 26));
  el.append(
    h('button', { class: 'icon-btn close', 'aria-label': tr('Close'), onclick: close }, icon('close', 26)),
    h('div', { class: 'viewer-stage' }, img), prev, next, cap);
  let x0 = null;
  el.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) < 50) return;
    // Swiping right reveals what is to the left: in RTL that is the next item.
    if (dx > 0) next.click(); else prev.click();
  });
  show();
}

function openCompare(list, urlFor) {
  const { el, close } = overlay('compare', tr('Before and after comparison'));
  let a = 0;
  let b = list.length - 1;
  let mode = 'slider';
  const body = h('div', { class: 'compare-body' });

  const select = (val, onChange, label) => h('select', { 'aria-label': label, onchange: (e) => onChange(Number(e.target.value)) },
    ...list.map((s, idx) => h('option', { value: idx, selected: idx === val }, caption(s))));

  const draw = async () => {
    clear(body);
    const [ua, ub] = await Promise.all([urlFor(list[a].checkin.photoId), urlFor(list[b].checkin.photoId)]);
    const ca = list[a].checkin;
    const cb = list[b].checkin;
    const sign = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}`;
    const diff = ca.weight && cb.weight
      ? h('p', { class: 'cmp-diff' }, ltr(sign(cb.weight - ca.weight)), tr(' kg · '), ltr(`${sign(cb.bf - ca.bf)}%`), tr(' fat'))
      : null;
    if (mode === 'slider') {
      const after = h('img', { src: ub, alt: tr('After: {0}', caption(list[b])), class: 'cmp-img' });
      const before = h('img', { src: ua, alt: tr('Before: {0}', caption(list[a])), class: 'cmp-img top' });
      const handle = h('div', { class: 'cmp-handle', 'aria-hidden': 'true' });
      const range = h('input', { type: 'range', min: 0, max: 100, value: 50, class: 'cmp-range', 'aria-label': tr('Comparison slider') });
      const stage = h('div', { class: 'cmp-stage', dir: 'ltr' }, after, before, handle, range,
        h('span', { class: 'cmp-tag left' }, tr('Before')), h('span', { class: 'cmp-tag right' }, tr('After')));
      const set = (v) => {
        before.style.clipPath = `inset(0 ${100 - v}% 0 0)`;
        handle.style.left = `${v}%`;
      };
      range.addEventListener('input', () => set(Number(range.value)));
      set(50);
      body.appendChild(stage);
    } else {
      body.appendChild(h('div', { class: 'cmp-side' },
        h('figure', null, h('img', { src: ua, alt: '' }), h('figcaption', null, tr('Before · '), caption(list[a]))),
        h('figure', null, h('img', { src: ub, alt: '' }), h('figcaption', null, tr('After · '), caption(list[b])))));
    }
    if (diff) body.appendChild(diff);
  };

  const modeSeg = h('div', { class: 'segmented small' },
    ...[['slider', tr('Slider')], ['side', tr('Side by side')]].map(([id, label]) => h('button', {
      class: mode === id ? 'on' : '',
      onclick: (e) => { mode = id; modeSeg.querySelectorAll('button').forEach((x) => x.classList.remove('on')); e.currentTarget.classList.add('on'); draw(); },
    }, label)));

  el.append(
    h('div', { class: 'compare-head' },
      h('h2', null, tr('Before / After')),
      h('button', { class: 'icon-btn', 'aria-label': tr('Close'), onclick: close }, icon('close', 24))),
    h('div', { class: 'compare-pickers' },
      h('label', null, h('span', null, tr('Before')), select(a, (v) => { a = v; draw(); }, tr('Week before'))),
      h('label', null, h('span', null, tr('After')), select(b, (v) => { b = v; draw(); }, tr('Week after')))),
    modeSeg,
    body);
  draw();
}
