// Registration wizard. Everything is kept in a draft until the last step;
// nothing is stored until the user finishes.

import { h, icon, clear, parseNum, fmt, toast } from '../util.js';
import { segmented, stepper, assessmentBox, disclaimer, dietNoteBox } from '../components.js';
import { GOALS, ACTIVITY, assessGoal, projectBf, computeTargets, validBf } from '../nutrition.js';
import { ALLERGENS, DIETS, FOODS, isAllowed, parseDislikes, dislikeMatches } from '../foods.js';
import { completeOnboarding } from '../store.js';
import { pickPhoto } from './photo-picker.js';
import { openBodyFatEstimator } from './bodyfat.js';
import { openFoodPicker, pickerLabel } from './food-picker.js';

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
  const d = loadDraft();
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
      let ok = setErr('name', d.name.trim().length >= 2 ? '' : 'יש להזין שם (לפחות 2 תווים).');
      ok = setErr('sex', d.sex ? '' : 'יש לבחור מין (משמש לחישוב קצב חילוף החומרים).') && ok;
      const age = parseNum(d.age);
      ok = setErr('age', age >= 16 && age <= 90 ? '' : 'גיל בין 16 ל-90.') && ok;
      const ht = parseNum(d.height);
      ok = setErr('height', ht >= 120 && ht <= 230 ? '' : 'גובה בין 120 ל-230 ס״מ.') && ok;
      return ok;
    },
    2: () => {
      const w = parseNum(d.weight);
      let ok = setErr('weight', w >= 30 && w <= 300 ? '' : 'משקל בין 30 ל-300 ק״ג.');
      ok = setErr('bf', validBf(parseNum(d.bf)) ? '' : 'אחוז שומן בין 3 ל-60.') && ok;
      return ok;
    },
    3: () => setErr('goal', d.goal ? '' : 'יש לבחור מטרה.'),
    4: () => {
      const wk = weeksValue();
      let ok = setErr('customWeeks', wk >= 2 && wk <= 52 ? '' : 'משך בין 2 ל-52 שבועות.');
      ok = setErr('targetWeight', parseNum(d.targetWeight) >= 30 ? '' : 'יש להזין משקל יעד.') && ok;
      ok = setErr('targetBf', validBf(parseNum(d.targetBf)) ? '' : 'אחוז שומן יעד בין 3 ל-60.') && ok;
      if (ok && assessment().level === 'error') {
        toast('יש לתקן את היעד לפני שממשיכים.');
        return false;
      }
      return ok;
    },
    5: () => setErr('activity', d.activity ? '' : 'יש לבחור רמת פעילות.'),
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
      toast('השמירה נכשלה. נסו שוב.');
      console.error(e);
    }
  }

  function stepBody() {
    switch (d.step) {
      case 0:
        return h('div', { class: 'welcome' },
          h('img', { src: 'icons/icon-512.png', alt: '', class: 'welcome-logo', width: 96, height: 96 }),
          h('h1', null, 'ברוכים הבאים לנוטרי'),
          h('p', { class: 'lead' }, 'תוכנית תזונה אישית לפי המטרה שלך — חיטוב, שמירה או מסה — עם תפריט יומי, עוזר תזונה חכם ומעקב התקדמות שבועי.'),
          h('ul', { class: 'bullets' },
            h('li', null, icon('lock', 18), 'כל הנתונים והתמונות נשמרים רק במכשיר שלך.'),
            h('li', null, icon('camera', 18), 'פעם בשבוע: תמונת התקדמות ושקילה — זו חובה, וזה מה שעושה את ההבדל.'),
            h('li', null, icon('chat', 18), 'עוזר תזונה שמכיר את התפריט וההגבלות שלך.')),
          disclaimer());
      case 1:
        return h('div', null,
          h('h2', null, 'קצת עליך'),
          field('שם', 'name', { type: 'text', autocomplete: 'given-name', enterkeyhint: 'next' }),
          h('div', { class: 'field' }, h('span', { id: 'lbl-sex' }, 'מין'),
            h('div', { id: 'ob-sex' }, segmented([{ id: 'male', label: 'גבר' }, { id: 'female', label: 'אישה' }], d.sex, (v) => { d.sex = v; saveDraft(d); }, 'מין')),
            h('div', { class: 'field-err', id: 'err-sex', role: 'alert' })),
          h('div', { class: 'grid2' },
            field('גיל', 'age', { type: 'text', inputmode: 'numeric' }),
            field('גובה (ס״מ)', 'height', { type: 'text', inputmode: 'numeric' })));
      case 2:
        return h('div', null,
          h('h2', null, 'המדדים שלך היום'),
          field('משקל (ק״ג)', 'weight', { type: 'text', inputmode: 'decimal' }),
          field('אחוז שומן (%)', 'bf', { type: 'text', inputmode: 'decimal' },
            'הערכה מספיקה: משקל חכם, קליפר או מדידה במכון. אחוז השומן מאפשר חישוב מדויק יותר (נוסחת Katch-McArdle).'),
          h('button', {
            type: 'button',
            class: 'btn btn-block bf-link',
            id: 'ob-bf-estimate',
            onclick: async () => {
              const w = parseNum(d.weight);
              const ok = setErr('weight', w >= 30 && w <= 300 ? '' : 'קודם הזינו משקל — הוא חלק מההערכה.');
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
          }, icon('camera', 18), 'לא יודע/ת את אחוז השומן שלך? לחצו כאן'));
      case 3:
        return h('div', null,
          h('h2', null, 'מה המטרה?'),
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
          [{ id: 4, label: '4' }, { id: 8, label: '8' }, { id: 12, label: '12' }, { id: 16, label: '16' }, { id: 'custom', label: 'אחר' }],
          d.weeks,
          (v) => { d.weeks = v; defaultTargets(); saveDraft(d); draw(); },
          'משך התקופה בשבועות');
        const body = h('div', null,
          h('h2', null, `תקופת ${GOALS[d.goal].label}`),
          h('div', { class: 'field' }, h('span', null, 'משך התקופה (שבועות)'), weeksSeg),
          d.weeks === 'custom'
            ? field('מספר שבועות', 'customWeeks', { type: 'text', inputmode: 'numeric', onupdate: () => { defaultTargets(); refresh(); } })
            : h('div', { id: 'err-customWeeks' }),
          h('div', { class: 'grid2' },
            field('משקל יעד (ק״ג)', 'targetWeight', { type: 'text', inputmode: 'decimal', onupdate: touched }),
            field('אחוז שומן יעד (%)', 'targetBf', { type: 'text', inputmode: 'decimal', onupdate: touched })),
          h('p', { class: 'muted small' }, `נוכחי: ${d.weight} ק״ג, ${d.bf}% שומן.`),
          assessEl);
        refresh();
        return body;
      }
      case 5:
        return h('div', null,
          h('h2', null, 'רמת פעילות'),
          h('p', { class: 'muted small' }, 'הפעילות היומיומית מחוץ לאימונים:'),
          h('div', { class: 'choice-list', id: 'ob-activity', role: 'radiogroup' },
            ...Object.entries(ACTIVITY).map(([id, a]) => h('button', {
              type: 'button',
              role: 'radio',
              'aria-checked': d.activity === id ? 'true' : 'false',
              class: 'choice' + (d.activity === id ? ' on' : ''),
              onclick: () => { d.activity = id; saveDraft(d); draw(); },
            }, h('span', null, h('strong', null, a.label), h('small', null, a.hint))))),
          h('div', { class: 'field-err', id: 'err-activity', role: 'alert' }),
          h('div', { class: 'field' }, h('span', null, 'אימונים בשבוע'),
            stepper(d.workouts, 0, 14, (v) => { d.workouts = v; saveDraft(d); }, 'אימונים בשבוע')));
      case 6: {
        const dietNote = dietNoteBox(d.diet);
        const dislikePreview = h('div', { class: 'muted small', 'aria-live': 'polite' });
        const updatePreview = () => {
          const terms = parseDislikes(d.dislikes);
          const hit = FOODS.filter((f) => dislikeMatches(f, terms)).map((f) => f.name);
          dislikePreview.textContent = hit.length ? `יוצאו מהתפריט: ${hit.join(', ')}` : '';
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
          h('h2', null, 'העדפות תזונה'),
          h('div', { class: 'field' }, h('span', null, 'סוג תזונה'),
            segmented(DIETS.map((x) => ({ id: x.id, label: x.label.split(' (')[0] })), d.diet, (v) => { d.diet = v; saveDraft(d); dietNote.update(v); }, 'סוג תזונה'),
            dietNote.el),
          h('label', { class: 'switch-row' },
            h('span', null, h('strong', null, 'כשרות'), h('small', { class: 'muted' }, 'בלי בשר וחלב באותה ארוחה, בלי מאכלים לא כשרים')),
            h('input', { type: 'checkbox', role: 'switch', checked: d.kosher, onchange: (e) => { d.kosher = e.target.checked; saveDraft(d); } })),
          h('div', { class: 'field' }, h('span', null, 'אלרגיות / רגישויות'), allergyChips),
          h('label', { class: 'field' }, h('span', null, 'מאכלים שאני לא אוכל/ת'),
            h('input', { type: 'text', value: d.dislikes, placeholder: 'לדוגמה: טונה, בטטה, קוטג׳', oninput: (e) => { d.dislikes = e.target.value; saveDraft(d); updatePreview(); } }),
            dislikePreview),
          h('button', {
            type: 'button', class: 'btn btn-block', id: 'btn-food-picker',
            onclick: (e) => {
              const btn = e.currentTarget;
              openFoodPicker({ diet: d.diet, kosher: d.kosher, allergies: d.allergies, dislikes: d.dislikes, excluded: d.excluded || [] }, (ids) => { d.excluded = ids; saveDraft(d); btn.lastChild.textContent = pickerLabel(ids); });
            },
          }, icon('edit', 18), h('span', null, pickerLabel(d.excluded))),
          h('div', { class: 'field' }, h('span', null, 'ארוחות ביום'),
            segmented([3, 4, 5, 6].map((n) => ({ id: n, label: String(n) })), d.mealsPerDay, (v) => { d.mealsPerDay = v; saveDraft(d); }, 'ארוחות ביום')));
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
            photoBox.append(h('img', { src: url, alt: 'תמונת פתיחה', class: 'baseline-img' }),
              h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => { baseline = null; drawPhoto(); } }, 'הסר'));
          } else {
            photoBox.append(h('button', {
              type: 'button',
              class: 'btn btn-block',
              onclick: async () => { const img = await pickPhoto(); if (img) { baseline = img; drawPhoto(); } },
            }, icon('camera', 18), 'הוספת תמונת פתיחה (מומלץ)'));
          }
        };
        drawPhoto();
        return h('div', null,
          h('h2', null, 'התוכנית שלך מוכנה'),
          h('div', { class: 'card summary' },
            h('div', { class: 'big num' }, fmt(t.calories), h('small', null, ' קק״ל ליום')),
            h('div', { class: 'macro-pills' },
              h('span', { class: 'pill protein' }, `חלבון ${t.protein} ג׳`),
              h('span', { class: 'pill carb' }, `פחמימה ${t.carbs} ג׳`),
              h('span', { class: 'pill fat' }, `שומן ${t.fat} ג׳`)),
            h('p', { class: 'muted small' },
              `הוצאה אנרגטית משוערת ${fmt(t.tdee)} קק״ל ביום (במנוחה ${fmt(t.bmr)}, לפי נוסחת `, h('span', { dir: 'ltr' }, t.method), '). ',
              t.deltaKcal ? `${t.deltaKcal < 0 ? 'גירעון' : 'עודף'} של ${Math.abs(t.deltaKcal)} קק״ל — קצב צפוי ${Math.abs(t.plannedKgPerWeek)} ק״ג בשבוע.` : 'קלוריות לשמירה.'),
            ...t.warnings.map((w) => h('p', { class: 'notice warn small' }, w)),
            protOk < 3 ? h('p', { class: 'notice warn small' }, 'ההגבלות שבחרת משאירות מעט מקורות חלבון. התפריט יעבוד, אבל יהיה פחות מגוון.') : null),
          h('h3', null, 'תמונת פתיחה (שבוע 0)'),
          h('p', { class: 'muted small' }, 'רשות, אבל שווה: היא תהיה נקודת ההשוואה שלך בגלריה. מהשבוע הבא הצילום השבועי הוא חובה.'),
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
      d.step > 0 ? h('button', { class: 'icon-btn', 'aria-label': 'חזרה', onclick: () => go(d.step - 1) }, icon('back')) : h('span', { class: 'icon-spacer' }),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': STEPS - 1, 'aria-valuenow': d.step, 'aria-label': 'התקדמות ההרשמה' },
        h('i', { style: { width: `${(d.step / (STEPS - 1)) * 100}%` } })),
      h('span', { class: 'step-count num' }, `${d.step + 1}/${STEPS}`));
    const footer = h('footer', { class: 'ob-foot' });
    const btn = h('button', { class: 'btn btn-primary btn-block btn-lg', id: 'ob-next' }, d.step === 0 ? 'בואו נתחיל' : isLast ? 'סיום והתחלה' : 'המשך');
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
