// Dashboard: today's meals, calorie/macro progress, period progress and the
// weight / body-fat chart.

import { t as tr, locale } from '../i18n.js';
import { h, icon, fmt, fmtDate, dayNumber, daysBetween, signed, ltr } from '../util.js';
import { ring, macroBar, mealCard, avatar } from '../components.js';
import { lineChart } from '../chart.js';
import { dayTotals } from '../mealplan.js';
import { dayMicros } from '../micros.js';
import { dayActivity } from '../habits.js';
import { waterCard, fastCard, activityCard, nutrientsCard, streakChip, checkBadges, framed, myEmblem } from './habits.js';
import { dayDrinks } from '../drinks.js';
import { GOALS } from '../nutrition.js';
import { state, today, targets, dayPlan, toggleEaten, gate, activePeriod, currentMetrics, periodEnded, saveSettings } from '../store.js';
import { openPeriodReview } from './period.js';
import { installCard } from '../install.js';
import { badgeCount, addMessage } from '../inbox.js';
import { openInviteSheet } from './friends.js';
import { challengeStrip } from './challenges.js';
import { cloudReady } from '../cloud.js';

let chartMode = 'weight';

// The bell: opens the inbox; the badge counts unread messages and waiting friend requests.
function bellLink() {
  const n = badgeCount();
  return h('a', { class: 'bell-link', id: 'bell', href: '#/inbox', 'aria-label': tr('Inbox') },
    icon('bell', 22), h('span', { class: 'bell-badge', hidden: !n }, n > 99 ? '99+' : String(n)));
}
window.addEventListener('app:inbox', () => {
  const n = badgeCount();
  document.querySelectorAll('.bell-badge').forEach((el) => { el.hidden = !n; el.textContent = n > 99 ? '99+' : String(n); });
});

export function renderToday(root, { askAbout }) {
  const day = today();
  const t = targets(day);
  const plan = dayPlan(day);
  const eaten = new Set((state.logs[day] || { eaten: [] }).eaten);
  // What was eaten, plus every drink logged today (drinks count once logged).
  const eatenTotals = dayTotals(plan, eaten);
  const drunk = dayDrinks(state.logs[day]);
  const consumed = { kcal: eatenTotals.kcal + drunk.kcal, p: eatenTotals.p + drunk.p, c: eatenTotals.c + drunk.c, f: eatenTotals.f + drunk.f };
  const g = gate();
  const p = activePeriod();
  const cur = currentMetrics();
  const hour = new Date().getHours();
  const hello = hour < 12 ? tr('Good morning') : hour < 18 ? tr('Good afternoon') : tr('Good evening');

  root.appendChild(h('header', { class: 'page-head today-head' },
    h('a', { class: 'head-avatar', href: '#/profile', 'aria-label': tr('Profile') }, framed(avatar(44), myEmblem(), 44)),
    h('div', { class: 'grow' },
      h('h1', null, `${hello}, ${state.profile.nickname || state.profile.name}`),
      h('p', { class: 'muted row gap' }, new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }), streakChip())),
    bellLink(),
    h('a', { class: 'checkin-chip', href: '#/gallery', 'aria-label': tr('Next weekly photo') },
      icon('camera', 16), g.daysToNext <= 0 ? tr('Today') : g.daysToNext === 1 ? tr('Photo tomorrow') : tr('{0, plural, one {Photo in # day} other {Photo in # days}}', g.daysToNext))));

  if (periodEnded(p, day)) {
    addMessage('period-ended', { id: `period-ended-${p.id}`, args: [p.goal] });
    root.appendChild(h('section', { class: 'card highlight', id: 'period-ended' },
      h('h2', null, tr('Your {0} period is over 🎉', GOALS[p.goal].label)),
      h('p', null, tr('Time to review your results and set up the next period.')),
      h('button', { class: 'btn btn-primary btn-block', onclick: () => openPeriodReview() }, tr('Review and set a new period'))));
  }

  const ic = installCard();
  if (ic && !state.settings.installDismissed) root.appendChild(ic);

  // ---- calories & macros ----
  const credit = state.settings.activityCredit ? dayActivity(state.logs[day]).credit : 0;
  const remaining = t.calories + credit - consumed.kcal;
  root.appendChild(h('section', { class: 'card progress-card' },
    h('div', { class: 'progress-top' },
      ring(consumed.kcal, t.calories, tr('kcal eaten'), tr('of {0}', fmt(t.calories))),
      h('div', { class: 'macros' },
        macroBar(tr('Protein'), 'protein', consumed.p, t.protein),
        macroBar(tr('Carbs‖checkin'), 'carb', consumed.c, t.carbs),
        macroBar(tr('Fat'), 'fat', consumed.f, t.fat))),
    h('p', { class: 'muted small center' },
      remaining >= 0 ? tr('{0} kcal left for today · water: {1} liters', fmt(remaining), t.water) : tr('Over by {0} kcal', fmt(-remaining)))));

  // ---- daily habits: the quick ones sit right under the calories ----
  for (const c of [waterCard(day, t.water), fastCard()]) if (c) root.appendChild(c);

  // ---- invite friends ----
  if (cloudReady()) {
    root.appendChild(h('section', { class: 'card invite-card', id: 'invite-card' },
      h('div', { class: 'invite-text' },
        h('h3', null, tr('Invite friends')),
        h('p', { class: 'muted small' }, tr('Invite a friend with a link on WhatsApp, or find them by username.'))),
      h('button', { type: 'button', class: 'btn btn-primary', id: 'btn-invite-today', onclick: openInviteSheet }, icon('send', 16), tr('Invite'))));
  }

  if (cloudReady()) root.appendChild(challengeStrip());

  // ---- meals ----
  root.appendChild(h('h2', { class: 'section-title' }, tr('Today\'s meals')));
  for (const m of plan) {
    root.appendChild(mealCard(m, { day, eaten: eaten.has(m.index), onToggle: () => toggleEaten(day, m.index), onAsk: askAbout }));
  }

  // ---- activity and nutrients ----
  for (const c of [activityCard(day), nutrientsCard(dayMicros(plan, eaten))]) if (c) root.appendChild(c);
  checkBadges();

  // ---- period progress ----
  if (p && cur) {
    const total = Math.max(1, daysBetween(p.startDate, p.endDate));
    const passed = Math.min(total, Math.max(0, daysBetween(p.startDate, day)));
    const span = p.targetWeight - p.startWeight;
    const done = span !== 0 ? Math.max(0, Math.min(1, (cur.weight - p.startWeight) / span)) : 1;
    root.appendChild(h('section', { class: 'card', id: 'period-card' },
      h('div', { class: 'row space' },
        h('h2', null, tr('{0} period', GOALS[p.goal].label)),
        h('span', { class: 'muted small num' }, tr('Week {0} of {1}', Math.min(Math.floor(passed / 7) + 1, Math.ceil(total / 7)), Math.ceil(total / 7)))),
      h('div', { class: 'bar time', 'aria-label': tr('Time elapsed in the period') }, h('i', { style: { width: `${(passed / total) * 100}%` } })),
      h('div', { class: 'period-stats' },
        h('div', null, h('small', null, tr('Start')), h('b', { class: 'num' }, `${fmt(p.startWeight, 1)}`), h('small', null, `${p.startBf ?? '—'}%`)),
        h('div', null, h('small', null, tr('now')), h('b', { class: 'num' }, `${fmt(cur.weight, 1)}`), h('small', null, `${cur.bf ?? '—'}%`)),
        h('div', null, h('small', null, tr('Target')), h('b', { class: 'num' }, `${fmt(p.targetWeight, 1)}`), h('small', null, `${p.targetBf ?? '—'}%`))),
      h('div', { class: 'bar goal', 'aria-label': tr('Progress toward the target weight') }, h('i', { style: { width: `${done * 100}%` } })),
      h('p', { class: 'muted small' },
        ltr(signed(cur.weight - p.startWeight)),
        tr(' kg since the start of the period · {0} {1} kcal a day · ends on {2}', t.deltaKcal < 0 ? tr('Deficit') : t.deltaKcal > 0 ? tr('Surplus') : tr('Balance'), Math.abs(t.deltaKcal), fmtDate(p.endDate))),
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
    chartBox.appendChild(lineChart(series, { target: target ?? null, unit: chartMode === 'weight' ? tr(' kg') : '%' }));
    if (series.length < 2) chartBox.appendChild(h('p', { class: 'muted small center' }, tr('The chart fills in with every weekly photo.')));
  };
  const toggle = h('div', { class: 'segmented small', role: 'radiogroup', 'aria-label': tr('Chart type') },
    ...[['weight', tr('Weight')], ['bf', tr('% fat')]].map(([id, label]) => h('button', {
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
    h('div', { class: 'row space' }, h('h2', null, tr('Trend')), toggle),
    chartBox));
}

export function dismissInstall() {
  return saveSettings({ installDismissed: true });
}
