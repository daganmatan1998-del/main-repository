// Today's habit cards (water, fasting, steps and workouts, nutrients), the
// streak chip, the badges on the profile and the switches that choose which
// cards Today shows. The rules live in habits.js and micros.js.

import { t as tr, locale } from '../i18n.js';
import { h, icon, sheet, toast, fmt, parseNum, fmtDate, clear } from '../util.js';
import * as hb from '../habits.js';
import { KEYS, REFERENCE } from '../micros.js';
import { state, today, patchLog, saveSettings, currentMetrics, nowMs, targets } from '../store.js';
import { addMessage } from '../inbox.js';
import { challengeList } from '../challenge-sync.js';
import * as ch from '../challenges.js';
import * as social from '../social.js';
import * as cloud from '../cloud.js';

// ---------- which cards are shown ----------
const CARD_DEFAULTS = { water: true, fast: false, activity: true, nutrients: true };
export const cardOn = (id) => ({ ...CARD_DEFAULTS, ...(state.settings.cards || {}) })[id];

const weightKg = () => (currentMetrics() || {}).weight || 70;
// Burned calories (steps and workouts) go back into the day's budget unless the person turned that off.
export const creditOn = () => state.settings.activityCredit !== false;

// ---------- badges ----------
export function habitStats() {
  return hb.statsFrom(state.logs, state.settings, today(), ch.record(challengeList()).wins);
}

// ---------- emblems ----------
// The emblem the person chose to show (only one they have reached).
export function myEmblem() {
  const e = hb.emblemInfo(state.settings.emblem);
  return e && habitStats().best >= e.days ? e.id : 0;
}

// The avatar with the emblem above it, on the right (no emblem: the avatar as it is).
export function framed(avatarEl, emblem, size = 44) {
  const info = hb.emblemInfo(emblem);
  if (!info) return avatarEl;
  const px = Math.max(18, Math.round(size * 0.55));
  return h('span', { class: 'avatar-wrap', title: info.name, 'data-emblem': info.id },
    avatarEl,
    h('img', { class: 'emblem', src: `img/emblems/${info.id}.webp`, alt: info.name, width: px, height: px, style: { width: `${px}px`, height: `${px}px` } }));
}

let emblemTry = 0;
async function syncEmblem(force = false) {
  const e = myEmblem();
  if (!cloud.cloudReady() || !cloud.signedIn() || state.settings.emblemSynced === e) return;
  if (!force && Date.now() - emblemTry < 5 * 60 * 1000) return;
  emblemTry = Date.now();
  try {
    if (await social.setMyLevel(e)) await saveSettings({ emblemSynced: e });
  } catch { /* offline or not set up: tried again later */ }
}

export async function setEmblem(id) {
  await saveSettings({ emblem: id });
  syncEmblem(true);
}

let checking = false;
// Stores the streak, the badges and the emblems reached since last time and tells the person once.
export async function checkBadges() {
  if (checking) return; // two renders at once must not announce twice
  checking = true;
  try {
    const s = state.settings;
    const stats = habitStats();
    const fresh = hb.newBadges(stats, s.badges || {});
    const before = hb.emblemsEarned(s.bestStreak || 0);
    const emblems = hb.emblemsEarned(stats.best).filter((id) => !before.includes(id));
    const patch = {};
    if (fresh.length) patch.badges = { ...(s.badges || {}), ...Object.fromEntries(fresh.map((id) => [id, today()])) };
    if (stats.best !== (s.bestStreak || 0)) patch.bestStreak = stats.best;
    if (stats.run.runLen !== (s.runLen || 0) || stats.run.runEnd !== (s.runEnd || '')) Object.assign(patch, stats.run);
    if (Object.keys(patch).length) await saveSettings(patch);
    for (const id of fresh) {
      const b = hb.BADGES.find((x) => x.id === id);
      addMessage('badge-earned', { id: `badge-${id}`, args: [b.name], link: '#/achievements' });
      toast(tr('New badge: {0}', b.name));
    }
    for (const id of emblems) {
      const e = hb.emblemInfo(id);
      addMessage('emblem-earned', { id: `emblem-${id}`, args: [e.name], link: '#/achievements' });
      toast(tr('New emblem: {0}', e.name));
    }
  } finally { checking = false; }
  syncEmblem();
}

export function streakChip() {
  const n = hb.advanceRun(state.logs, state.settings, today()).runLen;
  if (n < 1) return null;
  return h('a', { class: 'streak-chip', id: 'streak-chip', href: '#/achievements', 'aria-label': tr('{0, plural, one {# day streak} other {# days streak}}', n) },
    icon('flame', 16), h('b', { class: 'num' }, String(n)));
}

// The picker: every emblem, the reached ones can be chosen.
export function openEmblemSheet() {
  return sheet(tr('Profile icon'), (close) => {
    const best = habitStats().best;
    const chosen = myEmblem();
    const grid = h('div', { class: 'emblem-grid', id: 'emblem-grid' }, ...hb.EMBLEMS.map((e) => {
      const ok = best >= e.days;
      return h('button', {
        type: 'button', class: 'emblem-tile' + (ok ? '' : ' locked') + (chosen === e.id ? ' on' : ''), 'data-emblem': e.id, disabled: !ok,
        'aria-pressed': chosen === e.id ? 'true' : 'false',
        onclick: async () => { await setEmblem(e.id); close(); toast(tr('{0} added above your picture', e.name)); },
      },
      h('img', { src: `img/emblems/${e.id}.webp`, alt: '', width: 96, height: 96 }),
      h('b', null, e.name),
      h('small', { class: 'muted' }, ok ? e.tag : tr('{0, plural, one {# day in a row} other {# days in a row}}', e.days)));
    }));
    return h('div', null,
      h('p', { class: 'muted small' }, tr('Reach a streak to unlock an emblem, then choose one to show above your picture. Friends can see it.')),
      grid,
      chosen ? h('button', { type: 'button', class: 'btn btn-block btn-ghost', id: 'emblem-remove', onclick: async () => { await setEmblem(0); close(); } }, tr('Remove icon')) : null);
  });
}

// ---------- water ----------
// The day's goal (litres) comes from the plan (targets().water). Drinks count toward it
// from two places: the card (between meals) and each meal's own row. Quick buttons add
// half a litre or a litre; "Other" asks for any amount in millilitres.
const waterGoalFor = (day) => { const t = targets(day); return hb.waterGoalMl(t ? t.water : 2); };
const litres = (ml) => tr('{0} L', fmt(ml / 1000, 2));

// Applies { waterAdds } to the day and keeps `waterDone` (goal reached) in step.
async function patchWater(day, patch) {
  const log = { ...(state.logs[day] || { eaten: [] }), ...patch };
  await patchLog(day, { ...patch, waterDone: hb.waterTotalMl(log) >= waterGoalFor(day) });
}
const logWater = (day, ml, meal) => patchWater(day, { waterAdds: hb.addWater(state.logs[day], ml, meal) });
const undoLast = (day, meal) => patchWater(day, { waterAdds: hb.undoWater(state.logs[day], meal) });

// "How much did you drink?" — any amount in millilitres.
export function openWaterSheet(day, meal) {
  return sheet(tr('How much did you drink?'), (close) => {
    const input = h('input', { class: 'water-ml', id: 'water-ml', type: 'text', inputmode: 'decimal', placeholder: '330', 'aria-label': tr('Milliliters'), autocomplete: 'off' });
    const add = async () => {
      const ml = hb.parseMl(input.value);
      if (!(ml > 0)) { toast(tr('Write how many milliliters you drank')); input.focus(); return; }
      await logWater(day, ml, meal);
      close();
      checkBadges();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    setTimeout(() => input.focus(), 250);
    return h('div', null,
      h('label', { class: 'scan-qty' }, h('span', null, tr('Milliliters')), input),
      h('p', { class: 'muted small' }, tr('Write the amount in milliliters, for example 330.')),
      h('button', { type: 'button', class: 'btn btn-primary btn-block', id: 'water-ml-add', onclick: add }, icon('plus', 16), tr('Add')));
  });
}

// The three ways to add, and undo: used by the card and by each meal.
function waterButtons(day, meal, hasAny) {
  return h('div', { class: 'water-btns' },
    h('button', { type: 'button', class: 'icon-btn', 'data-act': 'water-undo', 'aria-label': tr('Undo the last drink'), disabled: !hasAny, onclick: () => undoLast(day, meal) }, icon('minus', 18)),
    ...hb.QUICK_ML.map((ml) => h('button', { type: 'button', class: 'btn btn-small btn-ghost water-quick', 'data-act': 'water-add', 'data-ml': ml, onclick: () => logWater(day, ml, meal) }, icon('plus', 14), tr('{0} L', fmt(ml / 1000, 2)))),
    h('button', { type: 'button', class: 'btn btn-small btn-ghost', 'data-act': 'water-other', onclick: () => openWaterSheet(day, meal) }, tr('Other amount')));
}

export function waterCard(day, liters) {
  if (!cardOn('water')) return null;
  const goal = hb.waterGoalMl(liters);
  const log = state.logs[day];
  const loose = hb.looseWaterMl(log);
  const inMeals = hb.waterWithMealsMl(log);
  const n = loose + inMeals;
  const hasLoose = hb.undoWater(log, -1).length !== (log && log.waterAdds ? log.waterAdds.length : 0);
  return h('section', { class: 'card habit-card', id: 'water-card' },
    h('div', { class: 'row space' },
      h('h3', null, icon('drop', 18), tr('Water')),
      h('span', { class: 'num muted small', id: 'water-count' }, tr('{0} of {1}', litres(n), litres(goal)))),
    h('div', { class: 'bar water', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': goal, 'aria-valuenow': Math.min(n, goal) }, h('i', { style: { width: `${Math.min(100, (n / goal) * 100)}%` } })),
    h('p', { class: 'muted small num', id: 'water-split' }, tr('With meals {0} · between meals {1}', litres(inMeals), litres(loose))),
    n >= goal ? h('p', { class: 'small', id: 'water-done' }, tr('Goal reached 🎉')) : null,
    waterButtons(day, -1, hasLoose));
}

// The water drunk with one meal, on the meal's page.
export function mealWaterRow(meal, day) {
  if (!cardOn('water')) return null;
  const log = state.logs[day];
  const n = hb.mealWaterMl(log, meal.index);
  const hasAny = hb.undoWater(log, meal.index).length !== (log && log.waterAdds ? log.waterAdds.length : 0);
  return h('div', { class: 'meal-water', 'data-meal': meal.index },
    h('div', { class: 'row space' },
      h('span', { class: 'meal-water-label' }, icon('drop', 16), tr('Water')),
      h('output', { class: 'num meal-water-n', 'aria-live': 'polite' }, litres(n))),
    waterButtons(day, meal.index, hasAny));
}

// Adds half a litre from outside the page (the home-screen shortcut).
export async function addGlass() {
  await logWater(today(), 500, -1);
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
  const a = hb.dayActivity(state.logs[day], weightKg());
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
      h('span', { class: 'muted small num', id: 'activity-kcal' }, a.kcal ? tr('{0} kcal burned', fmt(a.kcal)) : '')),
    h('div', { class: 'steps-row' },
      h('label', { class: 'grow' }, h('span', { class: 'muted small' }, tr('Steps')), steps),
      h('span', { class: 'muted small num' }, tr('Goal {0}', fmt(hb.STEP_GOAL)))),
    h('div', { class: 'bar steps' }, h('i', { style: { width: `${Math.min(100, (a.steps / hb.STEP_GOAL) * 100)}%` } })),
    list.length ? h('ul', { class: 'workout-list' }, ...list) : null,
    h('button', { type: 'button', class: 'btn btn-block btn-ghost', id: 'workout-add', onclick: () => openWorkoutSheet(day) }, icon('plus', 16), tr('Add a workout')),
    creditOn() && a.credit ? h('p', { class: 'muted small', id: 'activity-credit-note' }, tr('{0} kcal were added to today\'s budget', fmt(a.credit))) : null);
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
  const chosen = myEmblem();
  const nx = hb.nextEmblem(stats.best);
  const titleBox = h('div', { class: 'level-card', id: 'emblem-card' },
    h('div', { class: 'row space' }, h('h2', null, tr('Profile icon')),
      h('button', { type: 'button', class: 'btn btn-small btn-primary', id: 'btn-emblems', onclick: openEmblemSheet }, icon('plus', 16), chosen ? tr('Change icon') : tr('Add icon'))),
    h('div', { class: 'emblem-row' }, ...hb.EMBLEMS.map((e) => h('img', { class: 'emblem-mini' + (stats.best >= e.days ? '' : ' locked') + (chosen === e.id ? ' on' : ''), src: `img/emblems/${e.id}.webp`, alt: e.name, title: e.name, width: 44, height: 44, 'data-emblem': e.id }))),
    nx.next ? h('div', null, h('div', { class: 'bar' }, h('i', { style: { width: `${nx.pct * 100}%` } })),
      h('small', { class: 'muted', id: 'emblem-next' }, tr('Next emblem: {0} — {1, plural, one {# more day} other {# more days}}', nx.next.name, nx.left)))
      : h('small', { class: 'muted' }, tr('You have every emblem.')));
  return h('section', { class: 'card', id: 'badges-card' },
    titleBox,
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
      h('span', null, h('strong', null, tr('Subtract steps and workouts from my calories')), h('small', { class: 'muted block' }, tr('The calories burned are added back to the day\'s budget. They are estimates.'))),
      h('input', { type: 'checkbox', role: 'switch', id: 'activity-credit', checked: creditOn(), onchange: (e) => saveSettings({ activityCredit: e.target.checked }) })));
}
