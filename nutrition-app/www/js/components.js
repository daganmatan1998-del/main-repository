// Reusable UI pieces: macro rings/bars, meal cards, the swap sheet, metric forms.

import { h, icon, sheet, toast, fmt, parseNum, ltr } from './util.js';
import { FOOD_BY_ID, household, ROLE_LABEL } from './foods.js';
import { alternatives } from './substitutions.js';
import { state, setOverride } from './store.js';
import { validBf } from './nutrition.js';

export function ring(value, target, label, sub) {
  const pct = target > 0 ? Math.min(1, value / target) : 0;
  const over = target > 0 && value > target * 1.05;
  const r = 52;
  const c = 2 * Math.PI * r;
  const wrap = h('div', { class: 'ring' + (over ? ' over' : '') });
  wrap.innerHTML = `<svg viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="${r}" class="ring-bg"/>
    <circle cx="60" cy="60" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" transform="rotate(-90 60 60)"/>
  </svg>`;
  wrap.appendChild(h('div', { class: 'ring-label' },
    h('strong', null, fmt(value)),
    h('span', null, label),
    sub ? h('small', null, sub) : null));
  return wrap;
}

export function macroBar(name, cls, value, target) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return h('div', { class: `macro ${cls}` },
    h('div', { class: 'macro-head' },
      h('span', null, name),
      h('span', { class: 'num' }, `${fmt(value)} / ${fmt(target)} ג׳`)),
    h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': Math.round(value), 'aria-valuemax': Math.round(target), 'aria-label': name },
      h('i', { style: { width: `${pct}%` } })));
}

const SWAP_LABEL = { protein: 'החלף חלבון', carb: 'החלף פחמימה', fat: 'החלף שומן', fruit: 'החלף פרי', veg: 'החלף ירק' };

export function mealCard(meal, { day, eaten, onToggle, swaps = true, onAsk } = {}) {
  const card = h('section', { class: 'card meal' + (eaten ? ' eaten' : '') });
  const head = h('div', { class: 'meal-head' },
    h('div', null,
      h('h3', null, meal.name),
      h('div', { class: 'meal-sub num' }, `${fmt(meal.totals.kcal)} קק״ל · ח ${fmt(meal.totals.p)} · פ ${fmt(meal.totals.c)} · ש ${fmt(meal.totals.f)}`)),
    onToggle ? h('button', {
      class: 'check-btn' + (eaten ? ' on' : ''),
      'aria-pressed': eaten ? 'true' : 'false',
      'aria-label': eaten ? `בטל סימון ${meal.name}` : `סמן ${meal.name} כנאכלה`,
      onclick: onToggle,
    }, icon('check', 20), h('span', null, eaten ? 'נאכל' : 'סמן')) : null);
  card.appendChild(head);

  const list = h('ul', { class: 'items' });
  for (const it of meal.items) {
    const food = FOOD_BY_ID[it.foodId];
    const li = h('li', { class: `item role-${it.role}` },
      h('div', { class: 'item-main' },
        h('span', { class: 'role-dot', title: ROLE_LABEL[it.role] }),
        h('div', { class: 'item-text' },
          h('div', { class: 'item-name' }, food.name),
          h('div', { class: 'item-amt' },
            h('b', { class: 'num' }, `${fmt(it.grams)} ג׳`),
            h('span', null, ` · ${household(food, it.grams)}`),
            h('span', { class: 'muted num' }, ` · ${it.kcal} קק״ל`)))));
    if (swaps) {
      li.appendChild(h('button', {
        class: 'chip-btn',
        onclick: () => openSwapSheet(it, meal, day, onAsk),
      }, icon('swap', 16), SWAP_LABEL[it.role]));
    }
    list.appendChild(li);
  }
  card.appendChild(list);
  return card;
}

export function openSwapSheet(item, meal, day, onAsk) {
  const res = alternatives(item, meal, state.profile.prefs, 6);
  const keyName = { p: 'חלבון', c: 'פחמימות', f: 'שומן', kcal: 'קלוריות' }[res.matchedOn];
  const s = sheet(`${SWAP_LABEL[item.role]}: ${res.source.name}`, (close) => {
    const body = h('div', null,
      h('p', { class: 'muted small' },
        `במקום ${res.source.grams} ג׳ (${res.source.household}) — ${res.source.kcal} קק״ל. התחליפים מותאמים לאותה כמות ${keyName} ומסוננים לפי ההגבלות שלך.`));
    if (!res.options.length) {
      body.appendChild(h('p', { class: 'empty' }, 'אין תחליפים מתאימים במאגר עבור ההגבלות שלך. אפשר לשאול את העוזר.'));
    }
    const list = h('ul', { class: 'alt-list' });
    for (const o of res.options) {
      list.appendChild(h('li', { class: 'alt' },
        h('div', { class: 'alt-text' },
          h('div', { class: 'alt-name' }, o.name),
          h('div', { class: 'alt-amt' }, h('b', { class: 'num' }, `${o.grams} ג׳`), ` · ${o.household}`),
          h('div', { class: 'muted small num' },
            `${o.kcal} קק״ל `, ltr(`(${o.dKcal > 0 ? '+' : ''}${o.dKcal})`), ` · ח ${fmt(o.p, 1)} · פ ${fmt(o.c, 1)} · ש ${fmt(o.f, 1)}`)),
        h('button', {
          class: 'btn btn-small btn-primary',
          onclick: async () => {
            await setOverride(day, meal.index, { swap: { slot: item.slot, foodId: o.foodId, grams: o.grams } });
            close();
            toast(`הוחלף ל${o.name}`);
          },
        }, 'החלף')));
    }
    body.appendChild(list);
    if (onAsk) {
      body.appendChild(h('button', {
        class: 'btn btn-ghost btn-block',
        onclick: () => { close(); onAsk(item, meal, res); },
      }, icon('chat', 18), 'שאל את העוזר על תחליפים נוספים'));
    }
    return body;
  });
  return s;
}

// Weight + body-fat form with validation; used by the weekly gate and Profile.
export function metricsForm({ weight, bf, submitLabel = 'שמירה', onSubmit, previous }) {
  const wIn = h('input', { id: 'm-weight', type: 'text', inputmode: 'decimal', autocomplete: 'off', required: true, value: weight ?? '', 'aria-describedby': 'm-weight-err', placeholder: 'לדוגמה 72.5' });
  const bIn = h('input', { id: 'm-bf', type: 'text', inputmode: 'decimal', autocomplete: 'off', required: true, value: bf ?? '', 'aria-describedby': 'm-bf-err', placeholder: 'לדוגמה 18' });
  const wErr = h('div', { class: 'field-err', id: 'm-weight-err', role: 'alert' });
  const bErr = h('div', { class: 'field-err', id: 'm-bf-err', role: 'alert' });
  const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, submitLabel);
  const form = h('form', { class: 'form', novalidate: true },
    h('label', { class: 'field' }, h('span', null, 'משקל נוכחי (ק״ג)'), wIn, wErr),
    h('label', { class: 'field' }, h('span', null, 'אחוז שומן נוכחי (%)'), bIn, bErr,
      h('small', { class: 'muted' }, 'הערכה ממשקל חכם, קליפר או מדידה מקצועית. כדאי למדוד באותם תנאים בכל שבוע.')),
    btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const w = parseNum(wIn.value);
    const b = parseNum(bIn.value);
    let ok = true;
    wErr.textContent = '';
    bErr.textContent = '';
    if (!(w >= 30 && w <= 300)) { wErr.textContent = 'יש להזין משקל בין 30 ל-300 ק״ג.'; ok = false; }
    if (!validBf(b)) { bErr.textContent = 'יש להזין אחוז שומן בין 3 ל-60.'; ok = false; }
    wIn.setAttribute('aria-invalid', wErr.textContent ? 'true' : 'false');
    bIn.setAttribute('aria-invalid', bErr.textContent ? 'true' : 'false');
    if (ok && previous && Math.abs(w - previous.weight) > previous.weight * 0.1) {
      if (!form.dataset.confirmJump) {
        form.dataset.confirmJump = '1';
        wErr.textContent = `שינוי של ${Math.abs(w - previous.weight).toFixed(1)} ק״ג מהמדידה הקודמת. אם זה נכון — לחצו שוב לאישור.`;
        return;
      }
    }
    if (!ok) return;
    btn.disabled = true;
    try {
      await onSubmit(w, b);
    } finally {
      btn.disabled = false;
    }
  });
  return form;
}

export function segmented(options, value, onChange, name) {
  const wrap = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': name });
  for (const o of options) {
    const b = h('button', {
      type: 'button',
      role: 'radio',
      'aria-checked': o.id === value ? 'true' : 'false',
      class: o.id === value ? 'on' : '',
      onclick: () => {
        wrap.querySelectorAll('button').forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
        b.classList.add('on');
        b.setAttribute('aria-checked', 'true');
        onChange(o.id);
      },
    }, o.label);
    wrap.appendChild(b);
  }
  return wrap;
}

export function stepper(value, min, max, onChange, label) {
  let v = value;
  const out = h('output', { class: 'num', 'aria-live': 'polite' }, String(v));
  const set = (n) => { v = Math.max(min, Math.min(max, n)); out.textContent = String(v); onChange(v); };
  return h('div', { class: 'stepper', role: 'group', 'aria-label': label },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'הפחת', onclick: () => set(v - 1) }, icon('minus')),
    out,
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'הוסף', onclick: () => set(v + 1) }, icon('plus')));
}

export function assessmentBox(a, onApply) {
  if (!a || (a.level === 'ok' && !a.messages.length)) {
    return h('div', { class: 'notice ok' }, icon('check', 18), h('span', null, 'היעד ריאלי ובטוח לתקופה שנבחרה.'));
  }
  const box = h('div', { class: `notice ${a.level}`, role: 'alert' },
    h('div', null, ...a.messages.map((m) => h('p', null, m))));
  if (a.suggestion && onApply) {
    const s = a.suggestion;
    const opts = h('div', { class: 'row gap wrap' });
    if (s.weeks) opts.appendChild(h('button', { type: 'button', class: 'btn btn-small', onclick: () => onApply({ weeks: s.weeks }) }, `הארך ל-${s.weeks} שבועות`));
    if (s.targetWeight) opts.appendChild(h('button', { type: 'button', class: 'btn btn-small', onclick: () => onApply({ targetWeight: s.targetWeight }) }, `יעד ${s.targetWeight} ק״ג`));
    if (s.targetBf) opts.appendChild(h('button', { type: 'button', class: 'btn btn-small', onclick: () => onApply({ targetBf: s.targetBf }) }, `יעד שומן ${s.targetBf}%`));
    box.appendChild(h('div', null, h('p', { class: 'small' }, 'הצעה ריאלית:'), opts));
  }
  return box;
}

export function disclaimer() {
  return h('p', { class: 'disclaimer' }, icon('info', 16),
    'המידע באפליקציה הוא כללי ואינו מהווה ייעוץ רפואי. במצב רפואי, הריון, הפרעות אכילה או נטילת תרופות — יש להתייעץ עם רופא/ה או דיאטן/ית קליני/ת.');
}
