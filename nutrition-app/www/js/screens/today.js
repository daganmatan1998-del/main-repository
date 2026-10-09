// Dashboard: today's meals, calorie/macro progress, period progress and the
// weight / body-fat chart.

import { h, icon, fmt, fmtDate, dayNumber, daysBetween, signed, ltr } from '../util.js';
import { ring, macroBar, mealCard } from '../components.js';
import { lineChart } from '../chart.js';
import { dayTotals } from '../mealplan.js';
import { GOALS } from '../nutrition.js';
import { state, today, targets, dayPlan, toggleEaten, gate, activePeriod, currentMetrics, periodEnded, saveSettings } from '../store.js';
import { openPeriodReview } from './period.js';
import { installCard } from '../install.js';

let chartMode = 'weight';

export function renderToday(root, { askAbout }) {
  const day = today();
  const t = targets(day);
  const plan = dayPlan(day);
  const eaten = new Set((state.logs[day] || { eaten: [] }).eaten);
  const consumed = dayTotals(plan, eaten);
  const g = gate();
  const p = activePeriod();
  const cur = currentMetrics();
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'בוקר טוב' : hour < 18 ? 'צהריים טובים' : 'ערב טוב';

  root.appendChild(h('header', { class: 'page-head' },
    h('div', null,
      h('h1', null, `${hello}, ${state.profile.name}`),
      h('p', { class: 'muted' }, `יום ${new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}`)),
    h('a', { class: 'checkin-chip', href: '#/gallery', 'aria-label': 'הצילום השבועי הבא' },
      icon('camera', 16), g.daysToNext <= 0 ? 'היום' : g.daysToNext === 1 ? 'צילום מחר' : `צילום בעוד ${g.daysToNext} ימים`)));

  if (periodEnded(p, day)) {
    root.appendChild(h('section', { class: 'card highlight', id: 'period-ended' },
      h('h2', null, `תקופת ה${GOALS[p.goal].label} הסתיימה 🎉`),
      h('p', null, 'זה הזמן לסכם תוצאות ולהגדיר את התקופה הבאה.'),
      h('button', { class: 'btn btn-primary btn-block', onclick: () => openPeriodReview() }, 'סיכום והגדרת תקופה חדשה')));
  }

  const ic = installCard();
  if (ic && !state.settings.installDismissed) root.appendChild(ic);

  // ---- calories & macros ----
  const remaining = t.calories - consumed.kcal;
  root.appendChild(h('section', { class: 'card progress-card' },
    h('div', { class: 'progress-top' },
      ring(consumed.kcal, t.calories, 'קק״ל נאכלו', `מתוך ${fmt(t.calories)}`),
      h('div', { class: 'macros' },
        macroBar('חלבון', 'protein', consumed.p, t.protein),
        macroBar('פחמימה', 'carb', consumed.c, t.carbs),
        macroBar('שומן', 'fat', consumed.f, t.fat))),
    h('p', { class: 'muted small center' },
      remaining >= 0 ? `נותרו ${fmt(remaining)} קק״ל להיום · מים: ${t.water} ליטר` : `חריגה של ${fmt(-remaining)} קק״ל`)));

  // ---- meals ----
  root.appendChild(h('h2', { class: 'section-title' }, 'הארוחות של היום'));
  for (const m of plan) {
    root.appendChild(mealCard(m, { day, eaten: eaten.has(m.index), onToggle: () => toggleEaten(day, m.index), onAsk: askAbout }));
  }

  // ---- period progress ----
  if (p && cur) {
    const total = Math.max(1, daysBetween(p.startDate, p.endDate));
    const passed = Math.min(total, Math.max(0, daysBetween(p.startDate, day)));
    const span = p.targetWeight - p.startWeight;
    const done = span !== 0 ? Math.max(0, Math.min(1, (cur.weight - p.startWeight) / span)) : 1;
    root.appendChild(h('section', { class: 'card', id: 'period-card' },
      h('div', { class: 'row space' },
        h('h2', null, `תקופת ${GOALS[p.goal].label}`),
        h('span', { class: 'muted small num' }, `שבוע ${Math.min(Math.floor(passed / 7) + 1, Math.ceil(total / 7))} מתוך ${Math.ceil(total / 7)}`)),
      h('div', { class: 'bar time', 'aria-label': 'זמן שעבר בתקופה' }, h('i', { style: { width: `${(passed / total) * 100}%` } })),
      h('div', { class: 'period-stats' },
        h('div', null, h('small', null, 'התחלה'), h('b', { class: 'num' }, `${fmt(p.startWeight, 1)}`), h('small', null, `${p.startBf ?? '—'}%`)),
        h('div', null, h('small', null, 'עכשיו'), h('b', { class: 'num' }, `${fmt(cur.weight, 1)}`), h('small', null, `${cur.bf ?? '—'}%`)),
        h('div', null, h('small', null, 'יעד'), h('b', { class: 'num' }, `${fmt(p.targetWeight, 1)}`), h('small', null, `${p.targetBf ?? '—'}%`))),
      h('div', { class: 'bar goal', 'aria-label': 'התקדמות ליעד המשקל' }, h('i', { style: { width: `${done * 100}%` } })),
      h('p', { class: 'muted small' },
        ltr(signed(cur.weight - p.startWeight)),
        ` ק״ג מתחילת התקופה · ${t.deltaKcal < 0 ? 'גירעון' : t.deltaKcal > 0 ? 'עודף' : 'מאזן'} ${Math.abs(t.deltaKcal)} קק״ל ליום · מסתיימת ב-${fmtDate(p.endDate)}`),
      ...t.warnings.map((w) => h('p', { class: 'notice warn small' }, w))));
  }

  // ---- chart ----
  const chartBox = h('div', { class: 'chart-box' });
  const drawChart = () => {
    chartBox.innerHTML = '';
    const pts = state.metrics
      .filter((m) => (chartMode === 'weight' ? m.weight : m.bf) != null)
      .map((m) => ({ x: dayNumber(m.day), y: chartMode === 'weight' ? m.weight : m.bf, label: fmtDate(m.day) }));
    // One point per day (the last entry wins).
    const byDay = new Map(pts.map((pt) => [pt.x, pt]));
    const series = [...byDay.values()];
    const target = p ? (chartMode === 'weight' ? p.targetWeight : p.targetBf) : null;
    chartBox.appendChild(lineChart(series, { target: target ?? null, unit: chartMode === 'weight' ? ' ק״ג' : '%' }));
    if (series.length < 2) chartBox.appendChild(h('p', { class: 'muted small center' }, 'הגרף יתמלא עם כל צילום שבועי.'));
  };
  const toggle = h('div', { class: 'segmented small', role: 'radiogroup', 'aria-label': 'סוג גרף' },
    ...[['weight', 'משקל'], ['bf', '% שומן']].map(([id, label]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': chartMode === id ? 'true' : 'false', class: chartMode === id ? 'on' : '',
      onclick: (e) => {
        chartMode = id;
        toggle.querySelectorAll('button').forEach((b) => { b.classList.remove('on'); b.setAttribute('aria-checked', 'false'); });
        e.currentTarget.classList.add('on');
        e.currentTarget.setAttribute('aria-checked', 'true');
        drawChart();
      },
    }, label)));
  drawChart();
  root.appendChild(h('section', { class: 'card' },
    h('div', { class: 'row space' }, h('h2', null, 'מגמה'), toggle),
    chartBox));
}

export function dismissInstall() {
  return saveSettings({ installDismissed: true });
}
