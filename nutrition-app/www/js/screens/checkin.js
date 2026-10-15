// The weekly check-in gate: photo (step 1), weight + body fat (step 2),
// then a short summary. While the gate is active nothing else renders —
// app.js routes every navigation here until the check-in is complete.

import { t as tr } from '../i18n.js';
import { h, icon, clear, fmt, signed, fmtDate, ltr } from '../util.js';
import { metricsForm } from '../components.js';
import { state, saveCheckinPhoto, skipCheckinPhoto, completeCheckin, getPhoto, currentMetrics } from '../store.js';
import { photoButtons } from './photo-picker.js';

let summary = null;
export const hasSummary = () => !!summary;

function steps(active) {
  return h('ol', { class: 'gate-steps', 'aria-label': tr('Weekly photo steps') },
    h('li', { class: active === 1 ? 'on' : 'done' }, h('span', { class: 'num' }, active > 1 ? '✓' : '1'), tr('Photo')),
    h('li', { class: active === 2 ? 'on' : active > 2 ? 'done' : '' }, h('span', { class: 'num' }, active > 2 ? '✓' : '2'), tr('Weight and body fat')));
}

function missedWeeks(week) {
  const have = new Set(state.checkins.filter((c) => c.photoId).map((c) => c.week));
  const missed = [];
  for (let w = 1; w < week; w++) if (!have.has(w)) missed.push(w);
  return missed;
}

export function renderGate(root, gate) {
  clear(root);
  const wrap = h('div', { class: 'gate', id: 'gate', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gate-title' });
  root.appendChild(wrap);

  wrap.appendChild(h('div', { class: 'gate-badge' }, icon('camera', 18), tr('Weekly check-in')));
  wrap.appendChild(h('h1', { id: 'gate-title' }, tr('Progress photo — week {0}', gate.week)));
  wrap.appendChild(steps(gate.state === 'needsPhoto' ? 1 : 2));

  if (gate.state === 'needsPhoto') {
    const missed = missedWeeks(gate.week);
    wrap.append(...[
      h('p', { class: 'lead' }, tr('It\'s time for your weekly check-in (since {0}). Add a progress photo, or skip it, then update your weight and body fat.', fmtDate(gate.dueDay))),
      missed.length ? h('p', { class: 'notice warn small' }, tr('No photos for weeks {0} — they will appear empty in the gallery. Now taking week {1}.', missed.join(', '), gate.week)) : null,
      h('ul', { class: 'tips' },
        h('li', null, tr('The same light, the same place and the same pose every week')),
        h('li', null, tr('Preferably in the morning, before eating')),
        h('li', null, tr('The photo is saved only on your device — no internet needed'))),
      photoButtons(async (img) => { await saveCheckinPhoto(gate.week, img); }, { busyText: tr('Compressing and saving the photo…') }),
      h('button', { class: 'btn btn-block', id: 'skip-photo', type: 'button', onclick: () => skipCheckinPhoto(gate.week) }, tr('Skip the photo')),
    ].filter(Boolean));
  } else {
    const c = state.checkins.find((x) => x.week === gate.week);
    const prev = currentMetrics();
    const thumb = h('div', { class: 'gate-thumb' });
    if (c.photoId) getPhoto(c.photoId).then((p) => {
      if (!p) return;
      const url = URL.createObjectURL(p.blob);
      thumb.appendChild(h('img', { src: url, alt: tr('Week {0} photo', gate.week), onload: () => setTimeout(() => URL.revokeObjectURL(url), 1000) }));
    });
    const replace = h('details', { class: 'replace' },
      h('summary', null, c.photoId ? tr('Replace the photo?') : tr('Add a photo')),
      photoButtons(async (img) => { await saveCheckinPhoto(gate.week, img); }));
    wrap.append(...[
      c.photoId
        ? h('div', { class: 'row gap center-y' }, thumb, h('p', { class: 'small' }, icon('check', 16), tr(' The photo is saved. Only your measurements are left to update.')))
        : h('p', { class: 'small' }, tr('No photo this week. Only your measurements are left to update.')),
      replace,
      prev ? h('p', { class: 'muted small' }, tr('Previous measurement: {0} kg, {1}% body fat.', fmt(prev.weight, 1), prev.bf ?? '—')) : null,
      metricsForm({
        submitLabel: tr('Save and open the app'),
        previous: prev,
        person: () => ({ sex: state.profile.sex, age: state.profile.age, height: state.profile.height }),
        onSubmit: async (w, b) => {
          summary = await completeCheckin(gate.week, w, b);
          summary.week = gate.week;
        },
      }),
    ].filter(Boolean));
  }
}

export function renderSummary(root, onContinue) {
  const s = summary;
  clear(root);
  const b = s.before || s.after;
  const dw = s.after.weight - b.weight;
  const dbf = s.after.bf - (b.bf ?? s.after.bf);
  const fatBefore = b.bf ? (b.weight * b.bf) / 100 : null;
  const fatAfter = (s.after.weight * s.after.bf) / 100;
  const dFat = fatBefore !== null ? fatAfter - fatBefore : null;
  const dLean = fatBefore !== null ? (s.after.weight - fatAfter) - (b.weight - fatBefore) : null;
  const tb = s.targetsBefore;
  const ta = s.targetsAfter;
  const goal = state.periods.find((p) => p.status === 'active')?.goal;
  let msg = tr('Keep it up — consistency is key.');
  if (goal === 'cut' && dw < 0) msg = tr('Nice drop! You\'re keeping a steady pace.');
  if (goal === 'cut' && dw >= 0) msg = tr('No drop this week — it happens (water, salt, cycle). If it repeats for two weeks, the plan will adjust automatically.');
  if (goal === 'bulk' && dw > 0) msg = tr('Weight gain as planned. 💪');
  if (goal === 'bulk' && dw <= 0) msg = tr('No gain this week — make sure you eat all of your meals.');

  const row = (label, ...val) => h('div', { class: 'sum-row' }, h('span', null, label), h('b', null, ...val));
  const change = (a, b, unit = '') => [ltr(`${a} → ${b}`), unit];
  root.appendChild(h('div', { class: 'gate', id: 'checkin-summary' },
    h('div', { class: 'gate-badge ok' }, icon('check', 18), tr('The weekly photo is done')),
    h('h1', null, tr('Week {0} summary', s.week)),
    h('p', { class: 'lead' }, msg),
    h('div', { class: 'card' },
      row(tr('Weight'), tr('{0} kg ', fmt(s.after.weight, 1)), ltr(`(${signed(dw)})`, 'num delta')),
      row(tr('Body fat'), ltr(`${fmt(s.after.bf, 1)}%`), ' ', ltr(`(${signed(dbf)})`, 'num delta')),
      dFat !== null ? row(tr('Fat mass'), ltr(signed(dFat)), tr(' kg')) : null,
      dLean !== null ? row(tr('Lean mass'), ltr(signed(dLean)), tr(' kg')) : null),
    tb && ta ? h('div', { class: 'card' },
      h('h3', null, tr('The plan was updated')),
      row(tr('Calories'), ...change(fmt(tb.calories), fmt(ta.calories))),
      row(tr('Protein'), ...change(tb.protein, ta.protein, tr(' g'))),
      row(tr('Carbs‖checkin'), ...change(tb.carbs, ta.carbs, tr(' g'))),
      row(tr('Fat'), ...change(tb.fat, ta.fat, tr(' g'))),
      ...ta.warnings.map((w) => h('p', { class: 'notice warn small' }, w))) : null,
    h('button', { class: 'btn btn-primary btn-lg btn-block', id: 'summary-continue', onclick: () => { summary = null; onContinue(); } }, tr('Continue to the app'))));
}
