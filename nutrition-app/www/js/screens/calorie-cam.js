// Calorie camera: photograph the plate from above, get every item on it with
// grams and calories (Claude, via /api/meal-photo), fix anything it got
// wrong, and log the meal. If the plate isn't the planned meal, the user
// either updates the meal to what they ate or goes back to the camera: the
// meal is only logged once they confirm.
//
// The photo lives in memory only: it is sent once for analysis and never
// saved on the device or the server.

import { h, icon, clear, fmt, toast } from '../util.js';
import { API_BASE } from '../config.js';
import { FOODS, FOOD_BY_ID, household } from '../foods.js';
import { state, saveSettings, savePhotoMeal } from '../store.js';
import { toJpeg, fileToJpeg } from './bodyfat.js';
import { fromEstimate, custom, rename, withGrams, totalsOf, compareToPlan, record } from '../mealphoto.js';

const CONFIDENCE = { low: 'נמוכה', medium: 'בינונית', high: 'גבוהה' };
const MAX_SIDE = 1280; // enough detail to tell the sauce from the rice

export function openCalorieCamera(meal, day) {
  const el = h('div', { class: 'overlay bf mc keep', role: 'dialog', 'aria-modal': 'true', 'aria-label': `מצלמת קלוריות — ${meal.name}` });
  const body = h('div', { class: 'bf-body' });
  let stream = null;
  let shot = null; // { b64, url }
  let items = [];
  let estimate = null; // { confidence, notes }
  let done = false;

  const stopCamera = () => {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
  };
  const dropShot = () => {
    if (shot) URL.revokeObjectURL(shot.url);
    shot = null;
  };
  const close = () => {
    if (done) return;
    done = true;
    stopCamera();
    dropShot();
    el.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  const header = (title) => h('div', { class: 'bf-head' },
    h('h2', null, title),
    h('button', { class: 'icon-btn', 'aria-label': 'סגירה', onclick: close }, icon('close', 24)));

  // ---------- first use: what happens to the photo ----------
  function intro() {
    clear(body);
    const consent = h('input', { type: 'checkbox', id: 'mc-consent' });
    const start = h('button', { class: 'btn btn-primary btn-lg btn-block', id: 'mc-start', disabled: true, onclick: async () => { await saveSettings({ mealCamConsent: true }); capture(); } }, icon('camera'), 'פתיחת המצלמה');
    consent.addEventListener('change', () => { start.disabled = !consent.checked; });
    body.append(
      header('מצלמת קלוריות'),
      h('p', { class: 'lead' }, 'מצלמים את הצלחת מלמעלה, וה-AI מזהה כל מה שעליה — כולל רטבים ושמן — עם כמות וקלוריות לכל פריט. אחר כך אפשר לתקן כל כמות או מרכיב.'),
      h('div', { class: 'notice warn small' }, 'זו הערכה מתמונה: הכמויות עלולות לסטות, במיוחד ברטבים ובשמן. בדקו ותקנו לפני האישור.'),
      h('label', { class: 'bf-consent' }, consent,
        h('span', null, 'אני מסכים/ה שהתמונה תישלח לניתוח AI (Anthropic) דרך השרת של האפליקציה. היא לא נשמרת בשרת ולא באפליקציה.')),
      start);
  }

  // ---------- camera ----------
  async function capture(message) {
    dropShot();
    clear(body);
    const video = h('video', { class: 'bf-video', playsinline: true, muted: true, autoplay: true });
    video.muted = true;
    const stage = h('div', { class: 'bf-stage mc-stage' }, video,
      h('span', { class: 'mc-guide', 'aria-hidden': 'true' }),
      h('span', { class: 'mc-guide-text' }, 'כל הצלחת בתוך העיגול, מלמעלה'));
    const status = h('p', { class: 'muted small center', 'aria-live': 'polite' });
    const fileInput = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true', id: 'mc-file' });
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!f) return;
      status.textContent = 'מעבד…';
      try {
        shot = await fileToJpeg(f, MAX_SIDE);
        review();
      } catch {
        status.textContent = 'לא ניתן לפתוח את הקובץ. נסו תמונה אחרת.';
      }
    });
    const shoot = h('button', { class: 'btn btn-primary btn-lg grow', id: 'mc-shoot' }, icon('camera'), 'צילום');

    body.append(...[
      header(`מצלמת קלוריות — ${meal.name}`),
      message ? h('div', { class: 'notice warn small', id: 'mc-message' }, message) : null,
      h('ul', { class: 'tips' },
        h('li', null, 'צלמו מלמעלה, ישר מעל הצלחת'),
        h('li', null, 'הכניסו לפריים את כל מה שתאכלו: צלחות צד, רטבים, לחם, שתייה'),
        h('li', null, 'מזלג או כף ליד הצלחת עוזרים להעריך גודל')),
      stage,
      h('div', { class: 'row gap bf-controls' }, shoot),
      h('button', { class: 'btn btn-ghost btn-block', id: 'mc-upload', onclick: () => fileInput.click() }, icon('image', 18), 'העלאת תמונה קיימת'),
      status, fileInput,
    ].filter(Boolean));

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no camera api');
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1920 } },
          audio: false,
        });
      }
      if (done) { stopCamera(); return; }
      video.srcObject = stream;
      await video.play().catch(() => {});
    } catch {
      stopCamera();
      stage.classList.add('nocam');
      stage.appendChild(h('div', { class: 'bf-nocam' },
        h('p', null, 'אין גישה למצלמה מהאפליקציה.'),
        h('p', { class: 'small' }, 'אפשר לצלם במצלמת הטלפון ולהעלות, או לאשר גישה למצלמה בהגדרות הדפדפן.')));
      shoot.disabled = true;
      const camInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
      camInput.addEventListener('change', () => { fileInput.files = camInput.files; fileInput.dispatchEvent(new Event('change')); });
      body.appendChild(camInput);
      body.insertBefore(h('button', { class: 'btn btn-primary btn-lg btn-block', onclick: () => camInput.click() }, icon('camera'), 'צילום במצלמת הטלפון'), status);
    }

    shoot.addEventListener('click', async () => {
      if (!stream || !video.videoWidth) { status.textContent = 'המצלמה עוד נטענת…'; return; }
      shoot.disabled = true;
      stage.classList.add('flash');
      shot = await toJpeg(video, video.videoWidth, video.videoHeight, MAX_SIDE);
      review();
    });
  }

  function review() {
    stopCamera();
    clear(body);
    body.append(
      header('רואים את כל הארוחה?'),
      h('div', { class: 'bf-stage mc-stage' }, h('img', { src: shot.url, alt: 'הצלחת שצולמה', class: 'bf-shot' })),
      h('p', { class: 'small center' }, 'כל מה שתאכלו בתוך התמונה, כולל רטבים ושתייה?'),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn btn-primary btn-lg grow', id: 'mc-analyze', onclick: analyze }, icon('check'), 'ניתוח הצלחת'),
        h('button', { class: 'btn btn-lg', onclick: () => capture() }, 'צילום חוזר')));
  }

  // ---------- analysis ----------
  async function analyze() {
    clear(body);
    body.append(header('מנתח את הצלחת…'),
      h('div', { class: 'bf-wait' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', null, 'מזהה כל פריט וסופר קלוריות, זה לוקח כחצי דקה…')));
    let problem = null;
    try {
      if (!navigator.onLine) throw new Error('offline');
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 90000);
      const res = await fetch(`${API_BASE}/api/meal-photo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          photo: shot.b64,
          meal: meal.name,
          planned: meal.items.map((i) => ({ name: FOOD_BY_ID[i.foodId].name, grams: i.grams })),
          foods: FOODS.map((f) => ({ id: f.id, name: f.name })),
        }),
      });
      clearTimeout(t);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `http_${res.status}`);
      if (done) return;
      if (!data.ok) {
        capture(`לא הצלחנו לנתח את התמונה: ${data.issue || 'לא זוהה אוכל.'} צלמו שוב.`);
        return;
      }
      items = data.items.map(fromEstimate);
      estimate = { confidence: data.confidence, notes: data.notes };
      edit();
      return;
    } catch (e) {
      problem = e.message === 'offline' ? 'אין חיבור לאינטרנט — הניתוח צריך חיבור.'
        : e.message === 'not_configured' ? 'שירות הניתוח עוד לא הוגדר בשרת.'
        : e.message === 'rate_limited' ? 'יותר מדי בקשות ברגע זה. נסו שוב בעוד דקה.'
        : 'שירות הניתוח לא זמין כרגע.';
    }
    if (done) return;
    clear(body);
    body.append(header('הניתוח לא הצליח'),
      h('div', { class: 'notice warn' }, problem),
      h('button', { class: 'btn btn-primary btn-lg btn-block', id: 'mc-retry', onclick: analyze }, 'ניסיון חוזר'),
      h('button', { class: 'btn btn-ghost btn-block', onclick: () => capture() }, 'צילום חוזר'));
  }

  // ---------- review and fix the list ----------
  function edit() {
    clear(body);
    const list = h('ul', { class: 'mc-items', id: 'mc-items' });
    const totalBox = h('div', { class: 'mc-total card', 'aria-live': 'polite' });
    const err = h('p', { class: 'field-err', role: 'alert' });
    const datalist = h('datalist', { id: 'mc-foods' }, ...FOODS.map((f) => h('option', { value: f.name })));

    const refresh = () => {
      const t = totalsOf(items);
      clear(totalBox);
      totalBox.append(
        h('div', { class: 'mc-total-kcal' }, h('b', { class: 'num', id: 'mc-total' }, fmt(t.kcal)), h('span', null, ' קק״ל בצלחת')),
        h('div', { class: 'muted small num' }, `ח ${fmt(t.p)} · פ ${fmt(t.c)} · ש ${fmt(t.f)} ג׳ · בתפריט: ${fmt(meal.items.reduce((s, i) => s + i.kcal, 0))} קק״ל`));
    };
    const row = (idx) => {
      const it = items[idx];
      const name = h('input', { type: 'text', class: 'mc-name', value: it.name, list: 'mc-foods', 'aria-label': 'מרכיב', autocomplete: 'off' });
      const grams = h('input', { type: 'number', class: 'mc-grams num', inputmode: 'numeric', min: '0', max: '3000', step: '5', value: String(it.grams), 'aria-label': `גרמים — ${it.name}` });
      const kcal = h('span', { class: 'mc-kcal num' }, `${it.kcal} קק״ל`);
      const hh = h('span', { class: 'muted small mc-hh' }, it.foodId ? household(FOOD_BY_ID[it.foodId], it.grams) : '');
      const per100 = h('input', { type: 'number', class: 'mc-per100 num', inputmode: 'numeric', min: '0', max: '950', value: String(Math.round(it.per.kcal * 100)), 'aria-label': `קק״ל ל-100 ג׳ — ${it.name}` });
      const perWrap = h('label', { class: 'mc-per', hidden: !(it.custom && !it.foodId) }, h('span', { class: 'small muted' }, 'קק״ל ל-100 ג׳'), per100);
      const update = () => {
        kcal.textContent = `${items[idx].kcal} קק״ל`;
        hh.textContent = items[idx].foodId ? household(FOOD_BY_ID[items[idx].foodId], items[idx].grams) : '';
        perWrap.hidden = !(items[idx].custom && !items[idx].foodId);
        refresh();
      };
      grams.addEventListener('input', () => { items[idx] = withGrams(items[idx], grams.value); update(); });
      name.addEventListener('change', () => { items[idx] = rename(items[idx], name.value); name.value = items[idx].name; update(); });
      per100.addEventListener('input', () => {
        items[idx] = withGrams({ ...items[idx], per: { kcal: (Number(per100.value) || 0) / 100, p: 0, c: 0, f: 0 } }, items[idx].grams);
        update();
      });
      const li = h('li', { class: 'mc-item' + (it.confidence === 'low' ? ' unsure' : '') },
        h('div', { class: 'mc-line' },
          name,
          h('button', { class: 'icon-btn mc-del', 'aria-label': `הסרת ${it.name}`, onclick: () => { items.splice(idx, 1); draw(); } }, icon('close', 18))),
        h('div', { class: 'mc-line' },
          h('label', { class: 'mc-g' }, grams, h('span', null, 'ג׳')),
          hh, kcal),
        perWrap,
        it.seen && it.seen !== it.name ? h('div', { class: 'muted small' }, `זוהה בתמונה: ${it.seen}`) : null,
        it.confidence === 'low' ? h('div', { class: 'small mc-unsure' }, 'לא בטוח — בדקו את הפריט הזה') : null);
      return li;
    };
    const draw = () => {
      clear(list);
      items.forEach((_, i) => list.appendChild(row(i)));
      refresh();
    };
    const add = () => {
      items.push(custom('', 100, 0));
      draw();
      list.lastChild.querySelector('.mc-name').focus();
    };
    const confirm = () => {
      err.textContent = '';
      const clean = items.filter((i) => i.name && i.grams > 0);
      if (!clean.length) { err.textContent = 'צריך לפחות מרכיב אחד עם כמות.'; return; }
      if (clean.some((i) => i.custom && !i.foodId && i.per.kcal <= 0)) { err.textContent = 'למרכיב שהוספתם חסרות קלוריות ל-100 ג׳.'; return; }
      items = clean;
      decide();
    };

    body.append(...[
      header('מה יש בצלחת'),
      h('div', { class: 'mc-photo-row' },
        h('img', { src: shot.url, alt: 'הצלחת שצולמה', class: 'mc-thumb' }),
        h('div', null,
          h('p', { class: 'small' }, 'זה מה שזוהה. אפשר לשנות כמות (גרם) או מרכיב, למחוק ולהוסיף.'),
          h('p', { class: 'muted small' }, `רמת ביטחון: ${CONFIDENCE[estimate.confidence] || '—'}`))),
      estimate.notes ? h('p', { class: 'notice small' }, estimate.notes) : null,
      list,
      h('button', { class: 'btn btn-ghost btn-block', id: 'mc-add', onclick: add }, icon('plus', 18), 'הוספת מרכיב'),
      totalBox,
      err,
      h('button', { class: 'btn btn-primary btn-lg btn-block', id: 'mc-confirm', onclick: confirm }, icon('check'), 'אישור'),
      h('button', { class: 'btn btn-ghost btn-block', id: 'mc-retake', onclick: () => capture() }, 'צילום חוזר'),
      datalist,
    ].filter(Boolean));
    draw();
  }

  // ---------- planned meal or not ----------
  async function decide() {
    const cmp = compareToPlan(meal, items);
    if (cmp.matches) {
      await savePhotoMeal(day, meal.index, record(items, { replace: false, confidence: estimate.confidence }));
      toast(`${meal.name} תואמת לתפריט ✓ — סומנה כנאכלה`);
      close();
      return;
    }
    clear(body);
    body.append(...[
      header('הארוחה שונה מהתפריט'),
      h('p', { class: 'lead' }, `מה שבצלחת לא תואם את ${meal.name} כפי שהיא בתפריט.`),
      h('div', { class: 'card mc-diff' }, ...[
        cmp.extra.length ? h('p', null, h('b', null, 'לא בתפריט: '), cmp.extra.join(', ')) : null,
        cmp.missing.length ? h('p', null, h('b', null, 'בתפריט ולא בצלחת: '), cmp.missing.join(', ')) : null,
        h('p', { class: 'num' }, h('b', null, 'קלוריות: '), `${fmt(cmp.eaten)} בצלחת, ${fmt(cmp.planned)} בתפריט`),
      ].filter(Boolean)),
      h('p', null, 'לעדכן את רשימת המרכיבים של הארוחה למה שאכלת?'),
      h('button', { class: 'btn btn-primary btn-lg btn-block', id: 'mc-replace', onclick: async () => {
        await savePhotoMeal(day, meal.index, record(items, { replace: true, confidence: estimate.confidence }));
        toast(`${meal.name} עודכנה למה שאכלת ✓`);
        close();
      } }, 'כן, לעדכן למה שאכלתי'),
      h('button', { class: 'btn btn-lg btn-block', id: 'mc-no', onclick: () => capture('הארוחה לא עודכנה. צלמו את הארוחה מהתפריט — היא תסומן כנאכלה רק אחרי אישור.') }, 'לא — חזרה למצלמה'),
    ].filter(Boolean));
  }

  el.appendChild(body);
  document.body.appendChild(el);
  if (state.settings.mealCamConsent) capture(); else intro();
}
