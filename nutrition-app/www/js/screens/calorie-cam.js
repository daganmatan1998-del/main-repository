// Calorie camera: photograph the plate from above, get every item on it with
// grams and calories (Claude, via /api/meal-photo), fix anything it got
// wrong, and log the meal. If the plate isn't the planned meal, the user
// either updates the meal to what they ate or goes back to the camera: the
// meal is only logged once they confirm.
//
// The photo lives in memory only: it is sent once for analysis and never
// saved on the device or the server.

import { t as tr, lang } from '../i18n.js';
import { serverText } from '../server-texts.js';
import { h, icon, clear, fmt, toast } from '../util.js';
import { API_BASE } from '../config.js';
import { FOODS, FOOD_BY_ID, household } from '../foods.js';
import { state, saveSettings, savePhotoMeal } from '../store.js';
import { toJpeg, fileToJpeg } from './bodyfat.js';
import { fromEstimate, custom, rename, withGrams, totalsOf, compareToPlan, record } from '../mealphoto.js';

const CONFIDENCE = { low: tr('Low'), medium: tr('Medium'), high: tr('High') };
// Small on purpose: image tokens (and so free-tier quota and waiting time) grow with
// the picture. 768 px still tells rice from sauce; a plate is large in the frame.
const MAX_SIDE = 768;
const QUALITY = 0.65;

export function openCalorieCamera(meal, day) {
  const el = h('div', { class: 'overlay bf mc keep', role: 'dialog', 'aria-modal': 'true', 'aria-label': tr('Calorie camera — {0}', meal.name) });
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
    h('button', { class: 'icon-btn', 'aria-label': tr('Close'), onclick: close }, icon('close', 24)));

  // ---------- first use: what happens to the photo ----------
  function intro() {
    clear(body);
    const consent = h('input', { type: 'checkbox', id: 'mc-consent' });
    const start = h('button', { class: 'btn btn-primary btn-lg btn-block', id: 'mc-start', disabled: true, onclick: async () => { await saveSettings({ mealCamConsent: true }); capture(); } }, icon('camera'), tr('Open the camera'));
    consent.addEventListener('change', () => { start.disabled = !consent.checked; });
    body.append(
      header(tr('Calorie camera')),
      h('p', { class: 'lead' }, tr('Photograph your plate from above, and the app recognizes everything on it — including sauces and oil — with an amount and calories for each item. Then you can correct any amount or ingredient.')),
      h('div', { class: 'notice warn small' }, tr('This is an estimate from a photo: amounts may be off, especially for sauces and oil. Check and correct before you confirm.')),
      h('label', { class: 'bf-consent' }, consent,
        h('span', null, tr('I agree that the photo is sent for analysis to external analysis services through the app\'s server. The app does not store it, but some services may use the content to improve their service. Do not photograph documents or identifying details.'))),
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
      h('span', { class: 'mc-guide-text' }, tr('The whole plate inside the circle, from above')));
    const status = h('p', { class: 'muted small center', 'aria-live': 'polite' });
    const fileInput = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true', id: 'mc-file' });
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!f) return;
      status.textContent = tr('Processing…');
      try {
        shot = await fileToJpeg(f, MAX_SIDE, QUALITY);
        review();
      } catch {
        status.textContent = tr('Can\'t open the file. Try another image.');
      }
    });
    const shoot = h('button', { class: 'btn btn-primary btn-lg grow', id: 'mc-shoot' }, icon('camera'), tr('Take photo'));

    body.append(...[
      header(tr('Calorie camera — {0}', meal.name)),
      message ? h('div', { class: 'notice warn small', id: 'mc-message' }, message) : null,
      h('ul', { class: 'tips' },
        h('li', null, tr('Shoot from above, straight over the plate')),
        h('li', null, tr('Put everything you will eat in the frame: side dishes, sauces, bread, drinks')),
        h('li', null, tr('A fork or spoon next to the plate helps estimate the size'))),
      stage,
      h('div', { class: 'row gap bf-controls' }, shoot),
      h('button', { class: 'btn btn-ghost btn-block', id: 'mc-upload', onclick: () => fileInput.click() }, icon('image', 18), tr('Upload an existing photo')),
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
        h('p', null, tr('The app has no access to the camera.')),
        h('p', { class: 'small' }, tr('You can take the photo with the phone camera and upload it, or allow camera access in the browser settings.'))));
      shoot.disabled = true;
      const camInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
      camInput.addEventListener('change', () => { fileInput.files = camInput.files; fileInput.dispatchEvent(new Event('change')); });
      body.appendChild(camInput);
      body.insertBefore(h('button', { class: 'btn btn-primary btn-lg btn-block', onclick: () => camInput.click() }, icon('camera'), tr('Use the phone camera')), status);
    }

    shoot.addEventListener('click', async () => {
      if (!stream || !video.videoWidth) { status.textContent = tr('The camera is still loading…'); return; }
      shoot.disabled = true;
      stage.classList.add('flash');
      shot = await toJpeg(video, video.videoWidth, video.videoHeight, MAX_SIDE, QUALITY);
      review();
    });
  }

  function review() {
    stopCamera();
    clear(body);
    body.append(
      header(tr('Can you see the whole meal?')),
      h('div', { class: 'bf-stage mc-stage' }, h('img', { src: shot.url, alt: tr('The photographed plate'), class: 'bf-shot' })),
      h('p', { class: 'small center' }, tr('Is everything you will eat in the photo, including sauces and drinks?')),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn btn-primary btn-lg grow', id: 'mc-analyze', onclick: analyze }, icon('check'), tr('Analyze the plate')),
        h('button', { class: 'btn btn-lg', onclick: () => capture() }, tr('Retake'))));
  }

  // ---------- analysis ----------
  async function analyze() {
    clear(body);
    body.append(header(tr('Analyzing the plate…')),
      h('div', { class: 'bf-wait' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', null, tr('Identifying every item and counting calories — this takes about half a minute…'))));
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
          planned: meal.items.map((i) => ({ id: i.foodId, name: FOOD_BY_ID[i.foodId].name, grams: i.grams })),
          foods: FOODS.map((f) => f.id),
          lang,
        }),
      });
      clearTimeout(t);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `http_${res.status}`);
      if (done) return;
      if (!data.ok) {
        capture(tr('We couldn\'t analyze the photo: {0} Take another one.', serverText(data.issue) || tr('No food was recognized.')));
        return;
      }
      items = data.items.map(fromEstimate);
      estimate = { confidence: data.confidence, notes: data.notes, engine: data.engine };
      edit();
      return;
    } catch (e) {
      problem = e.message === 'offline' ? tr('No internet connection — the analysis needs a connection.')
        : e.message === 'not_configured' ? tr('The analysis service is not set up on the server yet.')
        : e.message === 'rate_limited' ? tr('Too many requests right now. Try again in a minute.')
        : e.message === 'all_engines_busy' ? tr('The analysis service is busy right now. Try again in a few minutes.')
        : tr('The analysis service is unavailable right now.');
    }
    if (done) return;
    clear(body);
    body.append(header(tr('The analysis did not work')),
      h('div', { class: 'notice warn' }, problem),
      h('button', { class: 'btn btn-primary btn-lg btn-block', id: 'mc-retry', onclick: analyze }, tr('Try again')),
      h('button', { class: 'btn btn-ghost btn-block', onclick: () => capture() }, tr('Retake')));
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
        h('div', { class: 'mc-total-kcal' }, h('b', { class: 'num', id: 'mc-total' }, fmt(t.kcal)), h('span', null, tr(' kcal on the plate'))),
        h('div', { class: 'muted small num' }, tr('P {0} · C {1} · F {2} g · on the menu: {3} kcal', fmt(t.p), fmt(t.c), fmt(t.f), fmt(meal.items.reduce((s, i) => s + i.kcal, 0)))));
    };
    const row = (idx) => {
      const it = items[idx];
      const name = h('input', { type: 'text', class: 'mc-name', value: it.name, list: 'mc-foods', 'aria-label': tr('Ingredient'), autocomplete: 'off' });
      const grams = h('input', { type: 'number', class: 'mc-grams num', inputmode: 'numeric', min: '0', max: '3000', step: '5', value: String(it.grams), 'aria-label': tr('Grams — {0}', it.name) });
      const kcal = h('span', { class: 'mc-kcal num' }, tr('{0} kcal', it.kcal));
      const hh = h('span', { class: 'muted small mc-hh' }, it.foodId ? household(FOOD_BY_ID[it.foodId], it.grams) : '');
      const per100 = h('input', { type: 'number', class: 'mc-per100 num', inputmode: 'numeric', min: '0', max: '950', value: String(Math.round(it.per.kcal * 100)), 'aria-label': tr('kcal per 100 g — {0}', it.name) });
      const perWrap = h('label', { class: 'mc-per', hidden: !(it.custom && !it.foodId) }, h('span', { class: 'small muted' }, tr('kcal per 100 g')), per100);
      const update = () => {
        kcal.textContent = tr('{0} kcal', items[idx].kcal);
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
          h('button', { class: 'icon-btn mc-del', 'aria-label': tr('Remove {0}', it.name), onclick: () => { items.splice(idx, 1); draw(); } }, icon('close', 18))),
        h('div', { class: 'mc-line' },
          h('label', { class: 'mc-g' }, grams, h('span', null, tr('g'))),
          hh, kcal),
        perWrap,
        it.seen && it.seen !== it.name ? h('div', { class: 'muted small' }, tr('Recognized in the photo: {0}', it.seen)) : null,
        it.confidence === 'low' ? h('div', { class: 'small mc-unsure' }, tr('Not sure — check this item')) : null);
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
      if (!clean.length) { err.textContent = tr('You need at least one ingredient with an amount.'); return; }
      if (clean.some((i) => i.custom && !i.foodId && i.per.kcal <= 0)) { err.textContent = tr('The ingredient you added is missing its calories per 100 g.'); return; }
      items = clean;
      decide();
    };

    body.append(...[
      header(tr('What\'s on the plate')),
      h('div', { class: 'mc-photo-row' },
        h('img', { src: shot.url, alt: tr('The photographed plate'), class: 'mc-thumb' }),
        h('div', null,
          h('p', { class: 'small' }, tr('This is what was recognized. You can change an amount (grams) or an ingredient, or delete and add items.')),
          h('p', { class: 'muted small' }, tr('Confidence: {0}', CONFIDENCE[estimate.confidence] || '—')),
          h('p', { class: 'muted small', id: 'mc-engine' }, tr('A quick estimate — check the amounts and sauces.')))),
      estimate.notes ? h('p', { class: 'notice small' }, estimate.notes) : null,
      list,
      h('button', { class: 'btn btn-ghost btn-block', id: 'mc-add', onclick: add }, icon('plus', 18), tr('Add an ingredient')),
      totalBox,
      err,
      h('button', { class: 'btn btn-primary btn-lg btn-block', id: 'mc-confirm', onclick: confirm }, icon('check'), tr('Confirm')),
      h('button', { class: 'btn btn-ghost btn-block', id: 'mc-retake', onclick: () => capture() }, tr('Retake')),
      datalist,
    ].filter(Boolean));
    draw();
  }

  // ---------- planned meal or not ----------
  async function decide() {
    const cmp = compareToPlan(meal, items);
    if (cmp.matches) {
      await savePhotoMeal(day, meal.index, record(items, { replace: false, confidence: estimate.confidence }));
      toast(tr('{0} matches the menu ✓ — marked as eaten', meal.name));
      close();
      return;
    }
    clear(body);
    body.append(...[
      header(tr('This meal differs from the menu')),
      h('p', { class: 'lead' }, tr('What\'s on the plate does not match {0} on your menu.', meal.name)),
      h('div', { class: 'card mc-diff' }, ...[
        cmp.extra.length ? h('p', null, h('b', null, tr('Not on the menu: ')), cmp.extra.join(', ')) : null,
        cmp.missing.length ? h('p', null, h('b', null, tr('On the menu but not on the plate: ')), cmp.missing.join(', ')) : null,
        h('p', { class: 'num' }, h('b', null, tr('Calories: ')), tr('{0} on the plate, {1} on the menu', fmt(cmp.eaten), fmt(cmp.planned))),
      ].filter(Boolean)),
      h('p', null, tr('Replace the meal\'s ingredient list with what you ate?')),
      h('button', { class: 'btn btn-primary btn-lg btn-block', id: 'mc-replace', onclick: async () => {
        await savePhotoMeal(day, meal.index, record(items, { replace: true, confidence: estimate.confidence }));
        toast(tr('{0} was updated to what you ate ✓', meal.name));
        close();
      } }, tr('Yes, update it to what I ate')),
      h('button', { class: 'btn btn-lg btn-block', id: 'mc-no', onclick: () => capture(tr('The meal was not updated. Photograph the meal on your menu — it\'s marked as eaten only after you confirm.')) }, tr('No — back to the camera')),
    ].filter(Boolean));
  }

  el.appendChild(body);
  document.body.appendChild(el);
  if (state.settings.mealCamConsent) capture(); else intro();
}
