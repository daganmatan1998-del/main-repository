// The weekly check-in gate: photo (step 1), weight + body fat (step 2),
// then a short summary. While the gate is active nothing else renders —
// app.js routes every navigation here until the check-in is complete.

import { h, icon, clear, fmt, signed, fmtDate, ltr } from '../util.js';
import { metricsForm } from '../components.js';
import { state, saveCheckinPhoto, completeCheckin, getPhoto, currentMetrics } from '../store.js';
import { photoButtons } from './photo-picker.js';

let summary = null;
export const hasSummary = () => !!summary;

function steps(active) {
  return h('ol', { class: 'gate-steps', 'aria-label': 'שלבי הצילום השבועי' },
    h('li', { class: active === 1 ? 'on' : 'done' }, h('span', { class: 'num' }, active > 1 ? '✓' : '1'), 'תמונה'),
    h('li', { class: active === 2 ? 'on' : active > 2 ? 'done' : '' }, h('span', { class: 'num' }, active > 2 ? '✓' : '2'), 'משקל ואחוז שומן'));
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

  wrap.appendChild(h('div', { class: 'gate-badge' }, icon('lock', 18), 'נדרש צילום שבועי'));
  wrap.appendChild(h('h1', { id: 'gate-title' }, `צילום התקדמות — שבוע ${gate.week}`));
  wrap.appendChild(steps(gate.state === 'needsPhoto' ? 1 : 2));

  if (gate.state === 'needsPhoto') {
    const missed = missedWeeks(gate.week);
    wrap.append(...[
      h('p', { class: 'lead' }, `הגיע הזמן לתמונה השבועית (מאז ${fmtDate(gate.dueDay)}). כדי להמשיך להשתמש באפליקציה יש להעלות תמונה ואז לעדכן משקל ואחוז שומן.`),
      missed.length ? h('p', { class: 'notice warn small' }, `שבועות ${missed.join(', ')} לא צולמו — הם יופיעו ריקים בגלריה. עכשיו מצלמים את שבוע ${gate.week}.`) : null,
      h('ul', { class: 'tips' },
        h('li', null, 'אותה תאורה, אותו מקום ואותה תנוחה בכל שבוע'),
        h('li', null, 'רצוי בבוקר, לפני אוכל'),
        h('li', null, 'התמונה נשמרת רק במכשיר — לא נדרש אינטרנט')),
      photoButtons(async (img) => { await saveCheckinPhoto(gate.week, img); }, { busyText: 'דוחס ושומר את התמונה…' }),
    ].filter(Boolean));
  } else {
    const c = state.checkins.find((x) => x.week === gate.week);
    const prev = currentMetrics();
    const thumb = h('div', { class: 'gate-thumb' });
    getPhoto(c.photoId).then((p) => {
      if (!p) return;
      const url = URL.createObjectURL(p.blob);
      thumb.appendChild(h('img', { src: url, alt: `תמונת שבוע ${gate.week}`, onload: () => setTimeout(() => URL.revokeObjectURL(url), 1000) }));
    });
    const replace = h('details', { class: 'replace' },
      h('summary', null, 'להחליף את התמונה?'),
      photoButtons(async (img) => { await saveCheckinPhoto(gate.week, img); }));
    wrap.append(...[
      h('div', { class: 'row gap center-y' }, thumb, h('p', { class: 'small' }, icon('check', 16), ' התמונה נשמרה. נשאר רק לעדכן מדדים.')),
      replace,
      prev ? h('p', { class: 'muted small' }, `המדידה הקודמת: ${fmt(prev.weight, 1)} ק״ג, ${prev.bf ?? '—'}% שומן.`) : null,
      metricsForm({
        submitLabel: 'שמירה ופתיחת האפליקציה',
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
  let msg = 'המשך כך — עקביות היא המפתח.';
  if (goal === 'cut' && dw < 0) msg = 'ירידה יפה! ממשיכים באותו קצב.';
  if (goal === 'cut' && dw >= 0) msg = 'השבוע בלי ירידה — זה קורה (מים, מלח, מחזור). אם זה חוזר שבועיים, התוכנית תתאים את עצמה.';
  if (goal === 'bulk' && dw > 0) msg = 'עלייה במשקל כמתוכנן. 💪';
  if (goal === 'bulk' && dw <= 0) msg = 'השבוע בלי עלייה — הקפידו לאכול את כל הארוחות.';

  const row = (label, ...val) => h('div', { class: 'sum-row' }, h('span', null, label), h('b', null, ...val));
  const change = (a, b, unit = '') => [ltr(`${a} → ${b}`), unit];
  root.appendChild(h('div', { class: 'gate', id: 'checkin-summary' },
    h('div', { class: 'gate-badge ok' }, icon('check', 18), 'הצילום השבועי הושלם'),
    h('h1', null, `סיכום שבוע ${s.week}`),
    h('p', { class: 'lead' }, msg),
    h('div', { class: 'card' },
      row('משקל', `${fmt(s.after.weight, 1)} ק״ג `, ltr(`(${signed(dw)})`, 'num delta')),
      row('אחוז שומן', ltr(`${fmt(s.after.bf, 1)}%`), ' ', ltr(`(${signed(dbf)})`, 'num delta')),
      dFat !== null ? row('מסת שומן', ltr(signed(dFat)), ' ק״ג') : null,
      dLean !== null ? row('מסה רזה', ltr(signed(dLean)), ' ק״ג') : null),
    tb && ta ? h('div', { class: 'card' },
      h('h3', null, 'התוכנית עודכנה'),
      row('קלוריות', ...change(fmt(tb.calories), fmt(ta.calories))),
      row('חלבון', ...change(tb.protein, ta.protein, ' ג׳')),
      row('פחמימה', ...change(tb.carbs, ta.carbs, ' ג׳')),
      row('שומן', ...change(tb.fat, ta.fat, ' ג׳')),
      ...ta.warnings.map((w) => h('p', { class: 'notice warn small' }, w))) : null,
    h('button', { class: 'btn btn-primary btn-lg btn-block', id: 'summary-continue', onclick: () => { summary = null; onContinue(); } }, 'המשך לאפליקציה')));
}
