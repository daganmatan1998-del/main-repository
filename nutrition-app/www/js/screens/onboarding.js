// Registration wizard. Everything is kept in a draft until the last step;
// nothing is stored until the user finishes.

import { t as tr } from '../i18n.js';
import { h, icon, clear, parseNum, fmt, toast } from '../util.js';
import { segmented, stepper, assessmentBox, disclaimer, dietNoteBox } from '../components.js';
import { GOALS, ACTIVITY, assessGoal, projectBf, computeTargets, validBf } from '../nutrition.js';
import { ALLERGENS, DIETS, FOODS, isAllowed, parseDislikes, dislikeMatches } from '../foods.js';
import { completeOnboarding } from '../store.js';
import { pickPhoto } from './photo-picker.js';
import { openBodyFatEstimator } from './bodyfat.js';
import { openFoodPicker, pickerLabel } from './food-picker.js';
import { cloudReady, currentUser } from '../cloud.js';
import { entryNeeded, renderEntry, backToEntry } from './entry.js';
import { languageBar } from './language.js';

const DRAFT_KEY = 'nutri-onboarding-draft';

function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (d) return d;
  } catch { /* storage unavailable */ }
  return {
    step: 0,
    name: '', sex: '', age: '', height: '', weight: '', bf: '',
    goal: '', weeks: 8, customWeeks: '', targetWeight: '', targetBf: '', targetsTouched: false,
    activity: '', workouts: 3,
    diet: 'omni', kosher: false, allergies: [], dislikes: '', excluded: [], mealsPerDay: 4,
  };
}

function saveDraft(d) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* ignore */ }
}

const STEPS = 8;

export function renderOnboarding(root) {
  // First screen: sign in / create an account / guest (see entry.js).
  if (entryNeeded()) { renderEntry(root); return; }
  const d = loadDraft();
  // Signed in with Google but nothing to restore: start from their first name.
  const u = currentUser();
  if (!d.name && u && u.name) d.name = u.name.split(' ')[0];
  let baseline = null; // compressed image, kept in memory only

  const go = (n) => { d.step = n; saveDraft(d); draw(); window.scrollTo(0, 0); };

  function defaultTargets() {
    if (d.targetsTouched) return;
    const w = parseNum(d.weight);
    const bf = parseNum(d.bf);
    if (!(w > 0)) return;
    const weeks = d.weeks === 'custom' ? parseNum(d.customWeeks) || 8 : d.weeks;
    let tw = w;
    if (d.goal === 'cut') tw = w * (1 - 0.006 * weeks);
    if (d.goal === 'bulk') tw = w * (1 + 0.0025 * weeks);
    d.targetWeight = String(Math.round(tw * 10) / 10);
    const pb = projectBf(d.goal, w, bf, tw);
    d.targetBf = pb !== null ? String(pb) : '';
  }

  function weeksValue() {
    return d.weeks === 'custom' ? Math.round(parseNum(d.customWeeks)) : d.weeks;
  }

  function assessment() {
    return assessGoal({
      goal: d.goal,
      weeks: weeksValue(),
      weight: parseNum(d.weight),
      bf: parseNum(d.bf),
      targetWeight: parseNum(d.targetWeight),
      targetBf: parseNum(d.targetBf),
      sex: d.sex,
      height: parseNum(d.height),
    });
  }

  function field(label, key, attrs = {}, hint) {
    const input = h('input', {
      id: `ob-${key}`,
      value: d[key],
      autocomplete: 'off',
      oninput: (e) => { d[key] = e.target.value; saveDraft(d); attrs.onupdate && attrs.onupdate(); },
      ...attrs,
    });
    return h('label', { class: 'field' }, h('span', null, label), input,
      h('div', { class: 'field-err', id: `err-${key}`, role: 'alert' }),
      hint ? h('small', { class: 'muted' }, hint) : null);
  }

  function setErr(key, msg) {
    const el = root.querySelector(`#err-${key}`);
    if (el) el.textContent = msg || '';
    const inp = root.querySelector(`#ob-${key}`);
    if (inp) inp.setAttribute('aria-invalid', msg ? 'true' : 'false');
    return !msg;
  }

  // Each validator returns true when the step may advance.
  const validators = {
    1: () => {
      let ok = setErr('name', d.name.trim().length >= 2 ? '' : tr('Enter a name (at least 2 characters).'));
      ok = setErr('sex', d.sex ? '' : tr('Choose your sex (used to calculate your metabolic rate).')) && ok;
      const age = parseNum(d.age);
      ok = setErr('age', age >= 16 && age <= 90 ? '' : tr('Age must be between 16 and 90.')) && ok;
      const ht = parseNum(d.height);
      ok = setErr('height', ht >= 120 && ht <= 230 ? '' : tr('Height must be between 120 and 230 cm.')) && ok;
      return ok;
    },
    2: () => {
      const w = parseNum(d.weight);
      let ok = setErr('weight', w >= 30 && w <= 300 ? '' : tr('Weight must be between 30 and 300 kg.'));
      ok = setErr('bf', validBf(parseNum(d.bf)) ? '' : tr('Body fat must be between 3 and 60%.')) && ok;
      return ok;
    },
    3: () => setErr('goal', d.goal ? '' : tr('Choose a goal.')),
    4: () => {
      const wk = weeksValue();
      let ok = setErr('customWeeks', wk >= 2 && wk <= 52 ? '' : tr('Length must be between 2 and 52 weeks.'));
      ok = setErr('targetWeight', parseNum(d.targetWeight) >= 30 ? '' : tr('Enter a target weight.')) && ok;
      ok = setErr('targetBf', validBf(parseNum(d.targetBf)) ? '' : tr('Target body fat must be between 3 and 60%.')) && ok;
      if (ok && assessment().level === 'error') {
        toast(tr('Fix the target before you continue.'));
        return false;
      }
      return ok;
    },
    5: () => setErr('activity', d.activity ? '' : tr('Choose an activity level.')),
  };

  function next() {
    const v = validators[d.step];
    if (v && !v()) {
      const firstErr = root.querySelector('[aria-invalid="true"]');
      if (firstErr) firstErr.focus();
      return;
    }
    if (d.step === 3) defaultTargets();
    go(d.step + 1);
  }

  function profileFromDraft() {
    return {
      name: d.name.trim(),
      sex: d.sex,
      age: parseNum(d.age),
      height: parseNum(d.height),
      activity: d.activity,
      workouts: d.workouts,
      prefs: { diet: d.diet, kosher: d.kosher, allergies: d.allergies, dislikes: d.dislikes.trim(), excluded: d.excluded || [], mealsPerDay: d.mealsPerDay },
    };
  }

  async function finish(btn) {
    btn.disabled = true;
    try {
      await completeOnboarding({
        profile: profileFromDraft(),
        period: { goal: d.goal, weeks: weeksValue(), targetWeight: parseNum(d.targetWeight), targetBf: parseNum(d.targetBf) },
        weight: parseNum(d.weight),
        bf: parseNum(d.bf),
        baseline,
      });
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      location.hash = '#/today';
    } catch (e) {
      btn.disabled = false;
      toast(tr('Saving failed. Try again.'));
      console.error(e);
    }
  }

  function stepBody() {
    switch (d.step) {
      case 0:
        return h('div', { class: 'welcome' },
          languageBar(),
          h('img', { src: 'icons/icon-512.png', alt: '', class: 'welcome-logo', width: 96, height: 96 }),
          h('h1', null, tr('Welcome to Nutri')),
          h('p', { class: 'lead' }, tr('A personal nutrition plan for your goal — cut, maintain or bulk — with a daily menu, a smart nutrition assistant and weekly progress tracking.')),
          h('ul', { class: 'bullets' },
            h('li', null, icon('lock', 18), tr('Your data is kept on your device and, if you want, in a private account in the cloud.')),
            h('li', null, icon('camera', 18), tr('Once a week: a progress photo (optional) and a weigh-in, so you can see your progress and keep your plan accurate.')),
            h('li', null, icon('chat', 18), tr('A nutrition assistant that knows your menu and restrictions.'))),
          cloudReady() && !currentUser() ? h('button', { type: 'button', class: 'btn btn-ghost', id: 'entry-back', onclick: backToEntry }, tr('I have an account or want to create one')) : null,
          disclaimer());
      case 1:
        return h('div', null,
          h('h2', null, tr('A little about you')),
          field(tr('Name'), 'name', { type: 'text', autocomplete: 'given-name', enterkeyhint: 'next' }),
          h('div', { class: 'field' }, h('span', { id: 'lbl-sex' }, tr('Sex')),
            h('div', { id: 'ob-sex' }, segmented([{ id: 'male', label: tr('Male') }, { id: 'female', label: tr('Female') }], d.sex, (v) => { d.sex = v; saveDraft(d); }, tr('Sex'))),
            h('div', { class: 'field-err', id: 'err-sex', role: 'alert' })),
          h('div', { class: 'grid2' },
            field(tr('Age'), 'age', { type: 'text', inputmode: 'numeric' }),
            field(tr('Height (cm)'), 'height', { type: 'text', inputmode: 'numeric' })));
      case 2:
        return h('div', null,
          h('h2', null, tr('Your measurements today')),
          field(tr('Weight (kg)'), 'weight', { type: 'text', inputmode: 'decimal' }),
          field(tr('Body fat (%)'), 'bf', { type: 'text', inputmode: 'decimal' },
            tr('An estimate is enough: a smart scale, calipers or a measurement at a gym. Knowing your body fat allows a more accurate calculation (the Katch-McArdle formula).')),
          h('button', {
            type: 'button',
            class: 'btn btn-block bf-link',
            id: 'ob-bf-estimate',
            onclick: async () => {
              const w = parseNum(d.weight);
              const ok = setErr('weight', w >= 30 && w <= 300 ? '' : tr('Enter your weight first — it is part of the estimate.'));
              if (!ok) { root.querySelector('#ob-weight').focus(); return; }
              const v = await openBodyFatEstimator({ sex: d.sex, age: parseNum(d.age), height: parseNum(d.height), weight: w });
              if (v !== null) {
                d.bf = String(v);
                saveDraft(d);
                const inp = root.querySelector('#ob-bf');
                if (inp) inp.value = d.bf;
                setErr('bf', '');
              }
            },
          }, icon('camera', 18), tr('Don\'t know your body fat? Tap here')));
      case 3:
        return h('div', null,
          h('h2', null, tr('What\'s your goal?')),
          h('div', { class: 'choice-list', id: 'ob-goal', role: 'radiogroup' },
            ...Object.entries(GOALS).map(([id, g]) => h('button', {
              type: 'button',
              role: 'radio',
              'aria-checked': d.goal === id ? 'true' : 'false',
              class: 'choice' + (d.goal === id ? ' on' : ''),
              onclick: () => { d.goal = id; d.targetsTouched = false; saveDraft(d); draw(); },
            }, h('span', { class: 'choice-icon' }, g.icon), h('span', null, h('strong', null, g.label), h('small', null, g.sub))))),
          h('div', { class: 'field-err', id: 'err-goal', role: 'alert' }));
      case 4: {
        const assessEl = h('div', { id: 'assess' });
        const refresh = () => { clear(assessEl).appendChild(assessmentBox(assessment(), apply)); };
        const apply = (patch) => {
          if (patch.weeks) {
            if ([4, 8, 12, 16].includes(patch.weeks)) d.weeks = patch.weeks;
            else { d.weeks = 'custom'; d.customWeeks = String(patch.weeks); }
          }
          if (patch.targetWeight) d.targetWeight = String(patch.targetWeight);
          if (patch.targetBf) d.targetBf = String(patch.targetBf);
          d.targetsTouched = true;
          saveDraft(d);
          draw();
        };
        const touched = () => { d.targetsTouched = true; refresh(); };
        const weeksSeg = segmented(
          [{ id: 4, label: '4' }, { id: 8, label: '8' }, { id: 12, label: '12' }, { id: 16, label: '16' }, { id: 'custom', label: tr('Other') }],
          d.weeks,
          (v) => { d.weeks = v; defaultTargets(); saveDraft(d); draw(); },
          tr('Length of the period in weeks'));
        const body = h('div', null,
          h('h2', null, tr('{0} period', GOALS[d.goal].label)),
          h('div', { class: 'field' }, h('span', null, tr('Length of the period (weeks)')), weeksSeg),
          d.weeks === 'custom'
            ? field(tr('Number of weeks'), 'customWeeks', { type: 'text', inputmode: 'numeric', onupdate: () => { defaultTargets(); refresh(); } })
            : h('div', { id: 'err-customWeeks' }),
          h('div', { class: 'grid2' },
            field(tr('Target weight (kg)'), 'targetWeight', { type: 'text', inputmode: 'decimal', onupdate: touched }),
            field(tr('Target body fat (%)'), 'targetBf', { type: 'text', inputmode: 'decimal', onupdate: touched })),
          h('p', { class: 'muted small' }, tr('Current: {0} kg, {1}% body fat.', d.weight, d.bf)),
          assessEl);
        refresh();
        return body;
      }
      case 5:
        return h('div', null,
          h('h2', null, tr('Activity level')),
          h('p', { class: 'muted small' }, tr('Your daily activity outside workouts:')),
          h('div', { class: 'choice-list', id: 'ob-activity', role: 'radiogroup' },
            ...Object.entries(ACTIVITY).map(([id, a]) => h('button', {
              type: 'button',
              role: 'radio',
              'aria-checked': d.activity === id ? 'true' : 'false',
              class: 'choice' + (d.activity === id ? ' on' : ''),
              onclick: () => { d.activity = id; saveDraft(d); draw(); },
            }, h('span', null, h('strong', null, a.label), h('small', null, a.hint))))),
          h('div', { class: 'field-err', id: 'err-activity', role: 'alert' }),
          h('div', { class: 'field' }, h('span', null, tr('Workouts per week')),
            stepper(d.workouts, 0, 14, (v) => { d.workouts = v; saveDraft(d); }, tr('Workouts per week'))));
      case 6: {
        const dietNote = dietNoteBox(d.diet);
        const dislikePreview = h('div', { class: 'muted small', 'aria-live': 'polite' });
        const updatePreview = () => {
          const terms = parseDislikes(d.dislikes);
          const hit = FOODS.filter((f) => dislikeMatches(f, terms)).map((f) => f.name);
          dislikePreview.textContent = hit.length ? tr('Taken out of the menu: {0}', hit.join(', ')) : '';
        };
        updatePreview();
        const allergyChips = h('div', { class: 'chips' },
          ...ALLERGENS.map((a) => h('button', {
            type: 'button',
            class: 'chip' + (d.allergies.includes(a.id) ? ' on' : ''),
            'aria-pressed': d.allergies.includes(a.id) ? 'true' : 'false',
            onclick: (e) => {
              d.allergies = d.allergies.includes(a.id) ? d.allergies.filter((x) => x !== a.id) : [...d.allergies, a.id];
              e.currentTarget.classList.toggle('on');
              e.currentTarget.setAttribute('aria-pressed', d.allergies.includes(a.id) ? 'true' : 'false');
              saveDraft(d);
            },
          }, a.label)));
        return h('div', null,
          h('h2', null, tr('Food preferences')),
          h('div', { class: 'field' }, h('span', null, tr('Diet type')),
            segmented(DIETS.map((x) => ({ id: x.id, label: x.label.split(' (')[0] })), d.diet, (v) => { d.diet = v; saveDraft(d); dietNote.update(v); }, tr('Diet type')),
            dietNote.el),
          h('label', { class: 'switch-row' },
            h('span', null, h('strong', null, tr('Kosher')), h('small', { class: 'muted' }, tr('No meat and dairy in the same meal, no non-kosher foods'))),
            h('input', { type: 'checkbox', role: 'switch', checked: d.kosher, onchange: (e) => { d.kosher = e.target.checked; saveDraft(d); } })),
          h('div', { class: 'field' }, h('span', null, tr('Allergies / sensitivities')), allergyChips),
          h('label', { class: 'field' }, h('span', null, tr('Foods I don\'t eat')),
            h('input', { type: 'text', value: d.dislikes, placeholder: tr('For example: tuna, sweet potato, cottage cheese'), oninput: (e) => { d.dislikes = e.target.value; saveDraft(d); updatePreview(); } }),
            dislikePreview),
          h('button', {
            type: 'button', class: 'btn btn-block', id: 'btn-food-picker',
            onclick: (e) => {
              const btn = e.currentTarget;
              openFoodPicker({ diet: d.diet, kosher: d.kosher, allergies: d.allergies, dislikes: d.dislikes, excluded: d.excluded || [] }, (ids) => { d.excluded = ids; saveDraft(d); btn.lastChild.textContent = pickerLabel(ids); });
            },
          }, icon('edit', 18), h('span', null, pickerLabel(d.excluded))),
          h('div', { class: 'field' }, h('span', null, tr('Meals per day')),
            segmented([3, 4, 5, 6].map((n) => ({ id: n, label: String(n) })), d.mealsPerDay, (v) => { d.mealsPerDay = v; saveDraft(d); }, tr('Meals per day'))));
      }
      case 7: {
        const profile = profileFromDraft();
        const today = new Date();
        const fakePeriod = { goal: d.goal, targetWeight: parseNum(d.targetWeight), endDate: new Date(today.getTime() + weeksValue() * 7 * 86400000).toISOString().slice(0, 10) };
        const t = computeTargets(profile, fakePeriod, { weight: parseNum(d.weight), bf: parseNum(d.bf) });
        const protOk = FOODS.filter((f) => f.role === 'protein' && isAllowed(f, profile.prefs)).length;
        const photoBox = h('div', { class: 'baseline' });
        const drawPhoto = () => {
          clear(photoBox);
          if (baseline) {
            const url = URL.createObjectURL(baseline.blob);
            photoBox.append(h('img', { src: url, alt: tr('Starting photo'), class: 'baseline-img' }),
              h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => { baseline = null; drawPhoto(); } }, tr('Remove')));
          } else {
            photoBox.append(h('button', {
              type: 'button',
              class: 'btn btn-block',
              onclick: async () => { const img = await pickPhoto(); if (img) { baseline = img; drawPhoto(); } },
            }, icon('camera', 18), tr('Add a starting photo (recommended)')));
          }
        };
        drawPhoto();
        return h('div', null,
          h('h2', null, tr('Your plan is ready')),
          h('div', { class: 'card summary' },
            h('div', { class: 'big num' }, fmt(t.calories), h('small', null, tr(' kcal per day'))),
            h('div', { class: 'macro-pills' },
              h('span', { class: 'pill protein' }, tr('Protein {0} g', t.protein)),
              h('span', { class: 'pill carb' }, tr('Carbs {0} g', t.carbs)),
              h('span', { class: 'pill fat' }, tr('Fat {0} g', t.fat))),
            h('p', { class: 'muted small' },
              tr('Estimated energy expenditure: {0} kcal per day (resting: {1}, using the {2}). ', fmt(t.tdee), fmt(t.bmr), `\u2066${t.method}\u2069`),
              t.deltaKcal ? tr('{0} of {1} kcal — expected pace {2} kg per week.', t.deltaKcal < 0 ? tr('Deficit') : tr('Surplus'), Math.abs(t.deltaKcal), Math.abs(t.plannedKgPerWeek)) : tr('Maintenance calories.')),
            ...t.warnings.map((w) => h('p', { class: 'notice warn small' }, w)),
            protOk < 3 ? h('p', { class: 'notice warn small' }, tr('Your restrictions leave few protein sources. The menu will work, but it will be less varied.')) : null),
          h('h3', null, tr('Starting photo (week 0)')),
          h('p', { class: 'muted small' }, tr('Optional, but worth it: it will be your point of comparison in the gallery.')),
          photoBox);
      }
      default:
        return h('div');
    }
  }

  function draw() {
    clear(root);
    const isLast = d.step === STEPS - 1;
    const header = h('header', { class: 'ob-head' },
      d.step > 0 ? h('button', { class: 'icon-btn', 'aria-label': tr('Back‖onboarding'), onclick: () => go(d.step - 1) }, icon('back')) : h('span', { class: 'icon-spacer' }),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': STEPS - 1, 'aria-valuenow': d.step, 'aria-label': tr('Registration progress') },
        h('i', { style: { width: `${(d.step / (STEPS - 1)) * 100}%` } })),
      h('span', { class: 'step-count num' }, `${d.step + 1}/${STEPS}`));
    const footer = h('footer', { class: 'ob-foot' });
    const btn = h('button', { class: 'btn btn-primary btn-block btn-lg', id: 'ob-next' }, d.step === 0 ? tr('Let\'s start') : isLast ? tr('Finish and start') : tr('Continue'));
    btn.addEventListener('click', () => (isLast ? finish(btn) : next()));
    footer.appendChild(btn);
    const body = h('div', { class: 'ob-body' }, stepBody());
    root.append(header, body, footer);
    body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); btn.click(); }
    });
  }

  draw();
}
