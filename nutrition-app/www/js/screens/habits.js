// Today's habit cards (water, fasting, steps and workouts, nutrients), the
// streak chip, the badges on the profile and the switches that choose which
// cards Today shows. The rules live in habits.js and micros.js.

import { t as tr, locale } from '../i18n.js';
import { h, icon, sheet, toast, fmt, parseNum, fmtDate, clear } from '../util.js';
import * as hb from '../habits.js';
import { KEYS, REFERENCE } from '../micros.js';
import { state, today, patchLog, saveSettings, currentMetrics, nowMs } from '../store.js';
import { addMessage } from '../inbox.js';
import { challengeList } from '../challenge-sync.js';
import * as ch from '../challenges.js';

// ---------- which cards are shown ----------
const CARD_DEFAULTS = { water: true, fast: false, activity: true, nutrients: true };
export const cardOn = (id) => ({ ...CARD_DEFAULTS, ...(state.settings.cards || {}) })[id];

const weightKg = () => (currentMetrics() || {}).weight || 70;

// ---------- badges ----------
export function habitStats() {
  return hb.statsFrom(state.logs, state.settings, today(), ch.record(challengeList()).wins);
}

// Stores the badges reached since last time and tells the person once.
export async function checkBadges() {
  const stats = habitStats();
  const have = state.settings.badges || {};
  const fresh = hb.newBadges(stats, have);
  const best = Math.max(state.settings.bestStreak || 0, stats.best);
  if (!fresh.length && best === (state.settings.bestStreak || 0)) return;
  const badges = { ...have };
  for (const id of fresh) badges[id] = today();
  await saveSettings({ badges, bestStreak: best });
  for (const id of fresh) {
    const b = hb.BADGES.find((x) => x.id === id);
    addMessage('badge-earned', { id: `badge-${id}`, args: [b.name], link: '#/profile' });
    toast(tr('New badge: {0}', b.name));
  }
}

export function streakChip() {
  const n = hb.streak(state.logs, today());
  if (n < 1) return null;
  return h('a', { class: 'streak-chip', id: 'streak-chip', href: '#/profile', 'aria-label': tr('{0, plural, one {# day streak} other {# days streak}}', n) },
    icon('flame', 16), h('b', { class: 'num' }, String(n)));
}

// ---------- water ----------
export function waterCard(day, liters) {
  if (!cardOn('water')) return null;
  const goal = hb.waterGoal(liters);
  const n = hb.glasses(state.logs[day]);
  const set = (v) => {
    const next = Math.max(0, Math.min(hb.MAX_GLASSES, v));
    return patchLog(day, { water: next, waterDone: next >= goal });
  };
  return h('section', { class: 'card habit-card', id: 'water-card' },
    h('div', { class: 'row space' },
      h('h3', null, icon('drop', 18), tr('Water')),
      h('span', { class: 'num muted small', id: 'water-count' }, tr('{0} of {1} glasses', n, goal))),
    h('div', { class: 'bar water', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': goal, 'aria-valuenow': Math.min(n, goal) }, h('i', { style: { width: `${Math.min(100, (n / goal) * 100)}%` } })),
    h('div', { class: 'row space habit-actions' },
      h('span', { class: 'muted small' }, n >= goal ? tr('Goal reached 🎉') : tr('One glass is {0} ml', hb.GLASS_ML)),
      h('div', { class: 'row gap' },
        h('button', { type: 'button', class: 'icon-btn', id: 'water-minus', 'aria-label': tr('Remove a glass'), disabled: n < 1, onclick: () => set(n - 1) }, icon('minus')),
        h('button', { type: 'button', class: 'btn btn-primary btn-small', id: 'water-plus', onclick: () => set(n + 1) }, icon('plus', 16), tr('Glass')))));
}

// Adds a glass from outside the page (the home-screen shortcut).
export async function addGlass() {
  const day = today();
  const log = state.logs[day];
  await patchLog(day, { water: Math.min(hb.MAX_GLASSES, hb.glasses(log) + 1) });
}

// ---------- fasting ----------
const timeText = (ms) => new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

export function fastCard() {
  if (!cardOn('fast')) return null;
  const fast = state.settings.fast || { protocol: hb.DEFAULT_PROTOCOL, startedAt: null, history: [] };
  const card = h('section', { class: 'card habit-card', id: 'fast-card' });
  const st = hb.fastState(fast, nowMs());
  const header = (extra) => h('div', { class: 'row space' }, h('h3', null, icon('clock', 18), tr('Fasting')), extra);

  if (st.on) {
    const elapsed = h('b', { class: 'num fast-time', id: 'fast-elapsed' }, hb.clock(st.elapsed));
    const bar = h('i', { style: { width: `${st.pct * 100}%` } });
    const note = h('p', { class: 'muted small', id: 'fast-note' });
    const paint = () => {
      const s = hb.fastState(state.settings.fast, nowMs());
      if (!s.on) return;
      elapsed.textContent = hb.clock(s.elapsed);
      bar.style.width = `${s.pct * 100}%`;
      note.textContent = s.reached ? tr('Goal reached. You can eat now, or keep going.') : tr('Eating window opens at {0} · {1} left', timeText(s.endsAt), hb.clock(s.remaining));
    };
    paint();
    const timer = setInterval(() => { if (!card.isConnected) { clearInterval(timer); return; } paint(); }, 30000);
    card.append(
      header(h('span', { class: 'muted small num' }, fast.protocol)),
      h('div', { class: 'fast-now' }, elapsed, h('span', { class: 'muted small' }, tr('hours fasted'))),
      h('div', { class: 'bar fast' }, bar),
      note,
      h('button', { type: 'button', class: 'btn btn-block', id: 'fast-end', onclick: async () => {
        const r = hb.endFast(state.settings.fast, nowMs());
        await saveSettings({ fast: r.fast });
        toast(r.done ? tr('Fast completed 🎉') : tr('Fast ended'));
        checkBadges();
      } }, tr('End the fast')));
    return card;
  }

  let protocol = hb.PROTOCOLS.some((p) => p.id === fast.protocol) ? fast.protocol : hb.DEFAULT_PROTOCOL;
  const chips = h('div', { class: 'segmented small', role: 'radiogroup', 'aria-label': tr('Fasting plan') });
  const drawChips = () => {
    clear(chips);
    for (const p of hb.PROTOCOLS) {
      chips.appendChild(h('button', { type: 'button', role: 'radio', 'data-protocol': p.id, 'aria-checked': p.id === protocol ? 'true' : 'false', class: p.id === protocol ? 'on' : '', onclick: () => { protocol = p.id; drawChips(); } }, tr('{0} h fast', p.hours)));
    }
  };
  drawChips();
  const since = h('input', { type: 'time', id: 'fast-since', class: 'fast-since', 'aria-label': tr('Started at (optional)') });
  const done = hb.fastsDone(fast);
  card.append(
    header(done ? h('span', { class: 'muted small' }, tr('{0, plural, one {# fast completed} other {# fasts completed}}', done)) : null),
    h('p', { class: 'muted small' }, tr('Pick a plan: you fast for the hours shown and eat in the rest.')),
    chips,
    h('label', { class: 'fast-since-row small muted' }, h('span', null, tr('Started at (optional)')), since),
    h('button', { type: 'button', class: 'btn btn-primary btn-block', id: 'fast-start', onclick: async () => {
      const now = nowMs();
      let at = now;
      if (since.value) {
        const [hh, mm] = since.value.split(':').map(Number);
        const d = new Date(now);
        d.setHours(hh, mm, 0, 0);
        at = d.getTime() > now ? d.getTime() - 86400000 : d.getTime();
      }
      await saveSettings({ fast: hb.startFast(state.settings.fast, protocol, now, at) });
    } }, tr('Start fasting')));
  return card;
}

// ---------- steps and workouts ----------
export function activityCard(day) {
  if (!cardOn('activity')) return null;
  const a = hb.dayActivity(state.logs[day]);
  const steps = h('input', { class: 'steps-in', id: 'steps-in', type: 'text', inputmode: 'numeric', placeholder: '0', value: a.steps || '', 'aria-label': tr('Steps today') });
  steps.addEventListener('change', () => {
    const v = parseNum(steps.value);
    patchLog(day, { steps: Number.isFinite(v) && v > 0 ? Math.min(hb.MAX_STEPS, Math.round(v)) : 0 }).then(checkBadges);
  });
  const list = a.workouts.map((w, i) => h('li', { class: 'workout-row', 'data-workout': w.type },
    h('span', null, (hb.WORKOUT_BY_ID[w.type] || hb.WORKOUT_BY_ID.other).name),
    h('span', { class: 'muted small num' }, tr('{0} min · {1} kcal', w.min, w.kcal)),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': tr('Remove'), onclick: () => patchLog(day, { workouts: a.workouts.filter((_, k) => k !== i) }) }, icon('close', 18))));
  return h('section', { class: 'card habit-card', id: 'activity-card' },
    h('div', { class: 'row space' }, h('h3', null, icon('run', 18), tr('Activity')),
      h('span', { class: 'muted small num' }, a.kcal ? tr('{0} kcal burned', fmt(a.kcal)) : '')),
    h('div', { class: 'steps-row' },
      h('label', { class: 'grow' }, h('span', { class: 'muted small' }, tr('Steps')), steps),
      h('span', { class: 'muted small num' }, tr('Goal {0}', fmt(hb.STEP_GOAL)))),
    h('div', { class: 'bar steps' }, h('i', { style: { width: `${Math.min(100, (a.steps / hb.STEP_GOAL) * 100)}%` } })),
    list.length ? h('ul', { class: 'workout-list' }, ...list) : null,
    h('button', { type: 'button', class: 'btn btn-block btn-ghost', id: 'workout-add', onclick: () => openWorkoutSheet(day) }, icon('plus', 16), tr('Add a workout')),
    state.settings.activityCredit && a.credit ? h('p', { class: 'muted small' }, tr('{0} kcal were added to today\'s budget', fmt(a.credit))) : null);
}

function openWorkoutSheet(day) {
  return sheet(tr('Add a workout'), (close) => {
    let type = 'walk';
    const minutes = h('input', { class: 'workout-min', id: 'workout-min', type: 'text', inputmode: 'numeric', value: '30', 'aria-label': tr('Minutes') });
    const est = h('p', { class: 'muted small num', id: 'workout-est', role: 'status', 'aria-live': 'polite' });
    const chips = h('div', { class: 'chips workout-types', role: 'radiogroup', 'aria-label': tr('Workout type') });
    const draw = () => {
      const m = parseNum(minutes.value);
      est.textContent = m > 0 ? tr('About {0} kcal', fmt(hb.makeWorkout(type, m, weightKg()).kcal)) : '';
      clear(chips);
      for (const w of hb.WORKOUTS) {
        chips.appendChild(h('button', { type: 'button', role: 'radio', 'data-type': w.id, 'aria-checked': w.id === type ? 'true' : 'false', class: 'chip' + (w.id === type ? ' on' : ''), onclick: () => { type = w.id; draw(); } }, w.name));
      }
    };
    minutes.addEventListener('input', draw);
    draw();
    const add = async () => {
      const m = parseNum(minutes.value);
      if (!(m > 0)) { toast(tr('Write how many minutes')); minutes.focus(); return; }
      const log = state.logs[day];
      await patchLog(day, { workouts: [...((log && log.workouts) || []), hb.makeWorkout(type, m, weightKg())].slice(-10) });
      close();
      checkBadges();
    };
    minutes.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    return h('div', null,
      chips,
      h('label', { class: 'scan-qty' }, h('span', null, tr('Minutes')), minutes),
      est,
      h('p', { class: 'muted small' }, tr('An estimate from the type of workout, the time and your weight.')),
      h('button', { type: 'button', class: 'btn btn-primary btn-block', id: 'workout-save', onclick: add }, icon('plus', 16), tr('Add')));
  });
}

// ---------- nutrients ----------
const NAMES = () => ({
  fiber: tr('Fiber'), sugar: tr('Sugars'), sodium: tr('Sodium'), potassium: tr('Potassium'),
  calcium: tr('Calcium'), iron: tr('Iron'), vitc: tr('Vitamin C'),
});

// m: dayMicros() of the meals marked as eaten.
export function nutrientsCard(m) {
  if (!cardOn('nutrients')) return null;
  const names = NAMES();
  const row = (k) => {
    const ref = REFERENCE[k];
    const v = m[k];
    const pct = Math.min(100, (v / ref.value) * 100);
    const over = !ref.goal && v > ref.value;
    return h('div', { class: 'nutrient' + (over ? ' over' : ''), 'data-nutrient': k },
      h('div', { class: 'row space' },
        h('span', null, names[k]),
        h('span', { class: 'num small' }, `${fmt(v, v < 10 ? 1 : 0)} / ${ref.goal ? '' : '≤ '}${fmt(ref.value)} ${ref.unit}`)),
      h('div', { class: 'bar' }, h('i', { style: { width: `${pct}%` } })));
  };
  const main = ['fiber', 'sugar', 'sodium'].map(row);
  const more = KEYS.filter((k) => !['fiber', 'sugar', 'sodium'].includes(k)).map(row);
  return h('section', { class: 'card habit-card', id: 'nutrients-card' },
    h('h3', null, tr('Nutrients today')),
    ...main,
    h('details', { class: 'nutrient-more' }, h('summary', null, tr('Vitamins and minerals')), ...more),
    h('p', { class: 'muted small' }, m.any
      ? (m.known ? tr('An estimate from the meals you marked as eaten.') : tr('An estimate from the meals you marked as eaten. Foods you typed or photographed are not counted.'))
      : tr('Mark a meal as eaten and its nutrients appear here.')));
}

// ---------- profile ----------
export function badgesCard() {
  const stats = habitStats();
  const have = state.settings.badges || {};
  const earned = hb.BADGES.filter((b) => have[b.id]).length;
  return h('section', { class: 'card', id: 'badges-card' },
    h('div', { class: 'row space' }, h('h2', null, tr('Achievements')), h('span', { class: 'muted small num' }, tr('{0} of {1}', earned, hb.BADGES.length))),
    h('div', { class: 'streak-row' },
      h('div', null, h('b', { class: 'num', id: 'streak-now' }, String(stats.streak)), h('small', { class: 'muted' }, tr('Current streak (days)'))),
      h('div', null, h('b', { class: 'num', id: 'streak-best' }, String(stats.best)), h('small', { class: 'muted' }, tr('Best streak (days)')))),
    h('ul', { class: 'badges' }, ...hb.BADGES.map((b) => h('li', { class: 'badge' + (have[b.id] ? ' on' : ''), 'data-badge': b.id, title: b.desc },
      h('span', { class: 'badge-ic' }, icon(b.icon, 22)),
      h('b', null, b.name),
      h('small', { class: 'muted' }, have[b.id] ? fmtDate(have[b.id]) : b.desc)))));
}

export function todaySettingsCard() {
  const row = (key, label, hint) => h('label', { class: 'switch-row' },
    h('span', null, h('strong', null, label), hint ? h('small', { class: 'muted block' }, hint) : null),
    h('input', { type: 'checkbox', role: 'switch', id: `cards-${key}`, checked: !!cardOn(key), onchange: (e) => saveSettings({ cards: { ...CARD_DEFAULTS, ...(state.settings.cards || {}), [key]: e.target.checked } }) }));
  return h('section', { class: 'card', id: 'today-cards' },
    h('h2', null, tr('Today screen')),
    h('p', { class: 'muted small' }, tr('Choose which cards appear on Today.')),
    row('water', tr('Water')),
    row('fast', tr('Intermittent fasting')),
    row('activity', tr('Steps and workouts')),
    row('nutrients', tr('Fiber, sugar, sodium and vitamins')),
    h('label', { class: 'switch-row' },
      h('span', null, h('strong', null, tr('Add workout calories to my budget')), h('small', { class: 'muted block' }, tr('Half of the calories burned are added, because estimates run high.'))),
      h('input', { type: 'checkbox', role: 'switch', id: 'activity-credit', checked: !!state.settings.activityCredit, onchange: (e) => saveSettings({ activityCredit: e.target.checked }) })));
}
