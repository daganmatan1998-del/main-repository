// Profile & settings.

import { h, icon, sheet, toast, fmt, fmtDate, parseNum, ltr, signed } from '../util.js';
import { metricsForm, segmented, stepper, disclaimer } from '../components.js';
import { GOALS, ACTIVITY } from '../nutrition.js';
import { ALLERGENS, DIETS, FOODS, parseDislikes, dislikeMatches } from '../foods.js';
import { state, targets, activePeriod, currentMetrics, addMetrics, updateProfile, saveSettings, wipe, currentWeek } from '../store.js';
import { openPeriodReview } from './period.js';
import { enableReminders, disableReminders, downloadCalendar, supported as notifSupported } from '../notify.js';
import { canInstall, isStandalone, promptInstall } from '../install.js';
import { applyTheme } from '../theme.js';
import { APP_VERSION } from '../config.js';

export function renderProfile(root) {
  const p = state.profile;
  const per = activePeriod();
  const cur = currentMetrics();
  const t = targets();

  root.appendChild(h('header', { class: 'page-head' },
    h('div', null, h('h1', null, p.name), h('p', { class: 'muted' }, `נרשמת ב-${fmtDate(p.regDay, true)} · שבוע ${currentWeek()}`))));

  // ---- metrics ----
  root.appendChild(h('section', { class: 'card' },
    h('h2', null, 'עדכון משקל ואחוז שומן'),
    h('p', { class: 'muted small' }, `אחרון: ${fmt(cur.weight, 1)} ק״ג, ${cur.bf ?? '—'}% (${fmtDate(cur.day)}). כל עדכון מחשב מחדש את התוכנית.`),
    metricsForm({
      submitLabel: 'עדכון וחישוב מחדש',
      previous: cur,
      onSubmit: async (w, b) => {
        await addMetrics(w, b, 'manual');
        toast('המדדים נשמרו והתוכנית עודכנה');
      },
    })));

  // ---- period & targets ----
  root.appendChild(h('section', { class: 'card', id: 'period-settings' },
    h('h2', null, `תקופה נוכחית: ${GOALS[per.goal].label}`),
    h('div', { class: 'kv' },
      h('span', null, 'תאריכים'), h('b', null, `מ-${fmtDate(per.startDate)} עד ${fmtDate(per.endDate)}`),
      h('span', null, 'יעד'), h('b', { class: 'num' }, `${fmt(per.targetWeight, 1)} ק״ג · ${per.targetBf ?? '—'}%`),
      h('span', null, 'יעד יומי'), h('b', null, `${fmt(t.calories)} קק״ל · חלבון ${t.protein} · פחמימה ${t.carbs} · שומן ${t.fat} ג׳`),
      h('span', null, 'חילוף חומרים'), h('b', null, `במנוחה ${fmt(t.bmr)} · כולל פעילות ${fmt(t.tdee)} קק״ל`, h('small', { class: 'muted', dir: 'ltr' }, ` ${t.method}`)),
      h('span', null, 'קצב מתוכנן'), h('b', null, ltr(signed(t.plannedKgPerWeek, 2)), ' ק״ג בשבוע')),
    h('button', { class: 'btn btn-block', onclick: () => openPeriodReview({ early: true }) }, 'סיום התקופה והגדרת תקופה חדשה')));

  // ---- details & preferences ----
  const diet = DIETS.find((x) => x.id === p.prefs.diet)?.label;
  const allergies = (p.prefs.allergies || []).map((a) => ALLERGENS.find((x) => x.id === a)?.label).join(', ') || 'אין';
  root.appendChild(h('section', { class: 'card' },
    h('div', { class: 'row space' }, h('h2', null, 'פרטים אישיים'), h('button', { class: 'btn btn-small btn-ghost', onclick: editDetails }, icon('edit', 16), 'עריכה')),
    h('div', { class: 'kv' },
      h('span', null, 'מין, גיל, גובה'), h('b', null, `${p.sex === 'female' ? 'אישה' : 'גבר'}, ${p.age}, ${p.height} ס״מ`),
      h('span', null, 'פעילות'), h('b', null, `${ACTIVITY[p.activity].label} · ${p.workouts} אימונים בשבוע`))));
  root.appendChild(h('section', { class: 'card' },
    h('div', { class: 'row space' }, h('h2', null, 'העדפות תזונה'), h('button', { class: 'btn btn-small btn-ghost', onclick: editPrefs }, icon('edit', 16), 'עריכה')),
    h('div', { class: 'kv' },
      h('span', null, 'תזונה'), h('b', null, `${diet}${p.prefs.kosher ? ' · כשר' : ''}`),
      h('span', null, 'אלרגיות'), h('b', null, allergies),
      h('span', null, 'לא אוכל/ת'), h('b', null, p.prefs.dislikes || '—'),
      h('span', null, 'ארוחות ביום'), h('b', null, String(p.prefs.mealsPerDay)))));

  // ---- app settings ----
  const remindersToggle = h('input', {
    type: 'checkbox', role: 'switch', checked: state.settings.reminders, disabled: !notifSupported(),
    onchange: async (e) => {
      if (e.target.checked) {
        const r = await enableReminders();
        if (r !== 'granted') { e.target.checked = false; toast(r === 'denied' ? 'ההתראות חסומות בהגדרות הדפדפן.' : 'ההתראות אינן נתמכות כאן.'); } else toast('תזכורות הופעלו');
      } else {
        await disableReminders();
      }
    },
  });
  root.appendChild(h('section', { class: 'card' },
    h('h2', null, 'הגדרות'),
    h('div', { class: 'field' }, h('span', null, 'מראה'),
      segmented([{ id: 'system', label: 'לפי המכשיר' }, { id: 'light', label: 'בהיר' }, { id: 'dark', label: 'כהה' }], state.settings.theme,
        async (v) => { await saveSettings({ theme: v }); applyTheme(v); }, 'ערכת צבעים')),
    h('label', { class: 'switch-row' },
      h('span', null, h('strong', null, 'תזכורת שבועית לצילום'), h('small', { class: 'muted' }, notifSupported() ? 'התראה ביום הצילום (כשהדפדפן תומך)' : 'הדפדפן הזה לא תומך בהתראות — השתמשו ביומן')),
      remindersToggle),
    h('button', { class: 'btn btn-block', onclick: () => downloadCalendar(p.regDay, currentWeek()) }, icon('bell', 18), 'הוספת תזכורת שבועית ליומן'),
    isStandalone()
      ? h('p', { class: 'muted small' }, icon('check', 14), ' האפליקציה מותקנת במכשיר.')
      : canInstall() ? h('button', { class: 'btn btn-block', onclick: () => promptInstall() }, icon('download', 18), 'התקנת האפליקציה במסך הבית') : null));

  // ---- privacy ----
  const storageInfo = h('p', { class: 'muted small' }, 'בודק אחסון…');
  (async () => {
    try {
      const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
      const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
      storageInfo.textContent = `${est ? `בשימוש: ${(est.usage / 1048576).toFixed(1)}MB. ` : ''}${persisted ? 'האחסון מוגן ממחיקה אוטומטית.' : 'הדפדפן עשוי לפנות אחסון אם המכשיר מתמלא — התקנת האפליקציה מקטינה את הסיכון.'}`;
    } catch { storageInfo.textContent = ''; }
  })();
  root.appendChild(h('section', { class: 'card' },
    h('h2', null, 'פרטיות'),
    h('ul', { class: 'bullets small' },
      h('li', null, icon('lock', 16), 'כל הנתונים — כולל תמונות ומדדי גוף — נשמרים רק במכשיר הזה (IndexedDB). אין חשבון ואין שרת שמחזיק אותם.'),
      h('li', null, icon('chat', 16), 'בשאלה לעוזר נשלחים רק נתוני התזונה הנחוצים (גיל, מדדים, יעד, תפריט והגבלות) — בלי שם ובלי תמונות.'),
      h('li', null, icon('info', 16), 'מחיקת האפליקציה או ניקוי נתוני האתר בדפדפן מוחקים גם את הנתונים.')),
    storageInfo,
    h('button', { class: 'btn btn-danger btn-block', id: 'btn-delete-all', onclick: deleteAll }, icon('trash', 18), 'מחיקת כל הנתונים')));

  root.appendChild(disclaimer());
  root.appendChild(h('p', { class: 'muted small center' }, `גרסה ${APP_VERSION}`));
}

function editDetails() {
  const p = state.profile;
  const d = { age: String(p.age), height: String(p.height), activity: p.activity, workouts: p.workouts, sex: p.sex };
  sheet('עריכת פרטים', (close) => {
    const err = h('p', { class: 'field-err', role: 'alert' });
    return h('div', { class: 'form' },
      h('div', { class: 'field' }, h('span', null, 'מין'), segmented([{ id: 'male', label: 'גבר' }, { id: 'female', label: 'אישה' }], d.sex, (v) => { d.sex = v; }, 'מין')),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', null, 'גיל'), h('input', { inputmode: 'numeric', value: d.age, oninput: (e) => { d.age = e.target.value; } })),
        h('label', { class: 'field' }, h('span', null, 'גובה (ס״מ)'), h('input', { inputmode: 'numeric', value: d.height, oninput: (e) => { d.height = e.target.value; } }))),
      h('div', { class: 'field' }, h('span', null, 'פעילות יומיומית'),
        segmented(Object.entries(ACTIVITY).map(([id, a]) => ({ id, label: a.label })), d.activity, (v) => { d.activity = v; }, 'פעילות')),
      h('div', { class: 'field' }, h('span', null, 'אימונים בשבוע'), stepper(d.workouts, 0, 14, (v) => { d.workouts = v; }, 'אימונים')),
      err,
      h('button', {
        class: 'btn btn-primary btn-block',
        onclick: async () => {
          const age = parseNum(d.age);
          const height = parseNum(d.height);
          if (!(age >= 16 && age <= 90) || !(height >= 120 && height <= 230)) { err.textContent = 'גיל 16–90, גובה 120–230 ס״מ.'; return; }
          await updateProfile({ age, height, activity: d.activity, workouts: d.workouts, sex: d.sex });
          close();
          toast('הפרטים עודכנו והתוכנית חושבה מחדש');
        },
      }, 'שמירה'));
  });
}

function editPrefs() {
  const p = state.profile.prefs;
  const d = { diet: p.diet, kosher: !!p.kosher, allergies: [...(p.allergies || [])], dislikes: p.dislikes || '', mealsPerDay: p.mealsPerDay };
  sheet('העדפות תזונה', (close) => {
    const preview = h('div', { class: 'muted small', 'aria-live': 'polite' });
    const upd = () => {
      const hit = FOODS.filter((f) => dislikeMatches(f, parseDislikes(d.dislikes))).map((f) => f.name);
      preview.textContent = hit.length ? `יוצאו מהתפריט: ${hit.join(', ')}` : '';
    };
    upd();
    return h('div', { class: 'form' },
      h('div', { class: 'field' }, h('span', null, 'סוג תזונה'), segmented(DIETS.map((x) => ({ id: x.id, label: x.label.split(' (')[0] })), d.diet, (v) => { d.diet = v; }, 'סוג תזונה')),
      h('label', { class: 'switch-row' }, h('span', null, h('strong', null, 'כשרות')),
        h('input', { type: 'checkbox', role: 'switch', checked: d.kosher, onchange: (e) => { d.kosher = e.target.checked; } })),
      h('div', { class: 'field' }, h('span', null, 'אלרגיות'),
        h('div', { class: 'chips' }, ...ALLERGENS.map((a) => h('button', {
          type: 'button', class: 'chip' + (d.allergies.includes(a.id) ? ' on' : ''), 'aria-pressed': d.allergies.includes(a.id) ? 'true' : 'false',
          onclick: (e) => {
            d.allergies = d.allergies.includes(a.id) ? d.allergies.filter((x) => x !== a.id) : [...d.allergies, a.id];
            e.currentTarget.classList.toggle('on');
            e.currentTarget.setAttribute('aria-pressed', d.allergies.includes(a.id) ? 'true' : 'false');
          },
        }, a.label)))),
      h('label', { class: 'field' }, h('span', null, 'מאכלים שאני לא אוכל/ת'),
        h('input', { value: d.dislikes, oninput: (e) => { d.dislikes = e.target.value; upd(); } }), preview),
      h('div', { class: 'field' }, h('span', null, 'ארוחות ביום'),
        segmented([3, 4, 5, 6].map((n) => ({ id: n, label: String(n) })), d.mealsPerDay, (v) => { d.mealsPerDay = v; }, 'ארוחות ביום')),
      h('button', {
        class: 'btn btn-primary btn-block',
        onclick: async () => {
          await updateProfile({ prefs: { ...d, dislikes: d.dislikes.trim() } });
          close();
          toast('ההעדפות נשמרו והתפריט עודכן');
        },
      }, 'שמירה'));
  });
}

function deleteAll() {
  sheet('מחיקת כל הנתונים', (close) => {
    const input = h('input', { id: 'confirm-delete', placeholder: 'הקלידו: מחק', autocomplete: 'off' });
    const btn = h('button', { class: 'btn btn-danger btn-block', id: 'confirm-delete-btn', disabled: true }, 'מחיקה לצמיתות');
    input.addEventListener('input', () => { btn.disabled = input.value.trim() !== 'מחק'; });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await wipe();
      } catch {
        btn.disabled = false;
        toast('המחיקה נחסמה — סגרו לשוניות אחרות של האפליקציה ונסו שוב.');
        return;
      }
      close();
      location.hash = '';
      location.reload();
    });
    return h('div', { class: 'form' },
      h('p', null, 'הפעולה תמחק מהמכשיר את הפרופיל, התוכנית, כל המדדים, כל התמונות והשיחות. אי אפשר לשחזר.'),
      h('label', { class: 'field' }, h('span', null, 'לאישור הקלידו "מחק"'), input),
      btn);
  });
}
