// Barcode scanner for "Add your own food": the camera reads the code (or a photo
// of it, or typed digits), the product comes from /api/barcode, and the person
// picks how much they ate — grams, servings, or the whole package.

import { t as tr } from '../i18n.js';
import { h, icon, sheet, toast, fmt, parseNum, clear } from '../util.js';
import { decodeSource, decodeFile, lookup, validCode, preload, amountModes, amountGrams, nutritionFor, searchProducts } from '../barcode.js';
import { commitCustom, modeControl } from '../custom-food.js';

// ctx: { meal, day, item, reopen } — reopen() goes back to the "Add your own
// food" sheet (when the product isn't found).
export function openScan(ctx) {
  preload();
  let stream = null;
  let stopped = false;
  let timer = 0;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  };

  const s = sheet(tr('Scan a barcode'), (close) => {
    const video = h('video', { class: 'scan-video', playsinline: 'true', muted: 'true', autoplay: 'true', 'aria-hidden': 'true' });
    video.muted = true;
    const status = h('p', { class: 'scan-status small', role: 'status', 'aria-live': 'polite' }, tr('Point the camera at the barcode'));
    const actions = h('div', { class: 'scan-actions' });

    let busy = false;
    const found = async (code) => {
      if (busy) return;
      busy = true;
      stop();
      if (navigator.vibrate) { try { navigator.vibrate(60); } catch { /* ignore */ } }
      clear(actions);
      status.textContent = tr('Looking up the product…');
      const p = await lookup(code);
      if (p.found) { close(); openProduct(p, ctx); return; }
      busy = false;
      if (p.error) {
        status.textContent = tr('The product database is not answering. Check your connection and try again.');
        actions.appendChild(h('button', { type: 'button', class: 'btn btn-block', id: 'scan-retry', onclick: () => found(code) }, tr('Try again')));
      } else {
        status.textContent = tr('This product is not in the database yet. You can add it by typing its calories.');
        actions.appendChild(h('button', { type: 'button', class: 'btn btn-primary btn-block', id: 'scan-manual', onclick: () => { close(); ctx.reopen && ctx.reopen(); } }, tr('Type it myself')));
      }
    };

    // Live camera: a frame a few times a second until a code reads.
    const tick = async () => {
      if (stopped || !stream) return;
      try {
        if (video.readyState >= 2 && video.videoWidth) {
          const code = await decodeSource(video, video.videoWidth, video.videoHeight, 1000);
          if (code && !stopped) { found(code); return; }
        }
      } catch { /* a bad frame: try the next one */ }
      timer = setTimeout(tick, 140);
    };
    (async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no camera api');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.srcObject = stream;
        try { await video.play(); } catch { /* autoplay is already on */ }
        const [track] = stream.getVideoTracks();
        try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch { /* not supported */ }
        tick();
      } catch {
        video.hidden = true;
        status.textContent = tr('The camera is not available. Type the number under the barcode, or choose a photo of it.');
      }
    })();

    // No camera, or an easier way: type the digits, or pick a photo.
    const digits = h('input', { class: 'scan-code', id: 'scan-code', type: 'text', inputmode: 'numeric', maxlength: 14, autocomplete: 'off', placeholder: tr('Barcode number'), 'aria-label': tr('Barcode number') });
    const go = () => {
      const code = digits.value.replace(/\D/g, '');
      if (!validCode(code)) { toast(tr('A barcode has 8 to 14 digits')); digits.focus(); return; }
      found(code);
    };
    digits.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    const file = h('input', { type: 'file', accept: 'image/*', class: 'scan-file', id: 'scan-file', hidden: true });
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      status.textContent = tr('Reading the photo…');
      let code = null;
      try { code = await decodeFile(f); } catch { /* not an image we can read */ }
      if (code) found(code);
      else status.textContent = tr('No barcode was found in the photo. Try a sharper, closer photo.');
    });

    return h('div', { class: 'scan' },
      h('div', { class: 'scan-view' }, video, h('div', { class: 'scan-reticle', 'aria-hidden': 'true' })),
      status,
      actions,
      h('div', { class: 'scan-manual' },
        digits,
        h('button', { type: 'button', class: 'btn btn-primary', id: 'scan-go', onclick: go }, tr('Look up'))),
      h('button', { type: 'button', class: 'btn btn-block btn-ghost', id: 'scan-photo', onclick: () => file.click() }, icon('image', 18), tr('Choose a photo of the barcode')),
      file);
  }, { onClose: stop });
  return s;
}

// Search packaged products by name (Open Food Facts) and pick one.
export function openProductSearch(ctx) {
  return sheet(tr('Search products'), (close) => {
    const input = h('input', { class: 'search', id: 'product-search', type: 'search', autocomplete: 'off', placeholder: tr('Product name, e.g. hummus, cornflakes…'), 'aria-label': tr('Search') });
    const status = h('p', { class: 'muted small', role: 'status', 'aria-live': 'polite' }, tr('Type at least 2 letters.'));
    const list = h('div', { class: 'extra-opts custom-opts', id: 'product-results' });
    let timer = 0;
    let seq = 0;
    const run = async () => {
      const q = input.value.trim();
      clear(list);
      if (q.length < 2) { status.textContent = tr('Type at least 2 letters.'); return; }
      const mine = ++seq;
      status.textContent = tr('Searching…');
      const r = await searchProducts(q);
      if (mine !== seq) return;
      if (r.error) { status.textContent = tr('The product database is not answering. Check your connection and try again.'); return; }
      if (!r.length) { status.textContent = tr('Nothing found. Try another word.'); return; }
      status.textContent = '';
      for (const p of r) {
        list.appendChild(h('div', { class: 'alt extra-opt', 'data-code': p.code },
          h('div', { class: 'alt-text' },
            h('div', { class: 'alt-name' }, p.brand && !p.name.toLowerCase().includes(p.brand.toLowerCase()) ? `${p.name} · ${p.brand}` : p.name),
            h('div', { class: 'muted small num' }, tr('Per 100 g: {0} kcal', p.per100.kcal))),
          h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: () => { close(); openProduct(p, ctx); } }, tr('Choose'))));
      }
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 450); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); run(); } });
    setTimeout(() => input.focus(), 250);
    return h('div', null, input, status, list, CREDIT());
  });
}

// Open Food Facts asks to be credited (data under the ODbL licence).
const CREDIT = () => h('p', { class: 'muted small scan-credit', dir: 'ltr' }, 'Open Food Facts · ODbL');

// The product: pick how much was eaten and add it to the meal.
export function openProduct(p, ctx) {
  const title = p.brand && !p.name.toLowerCase().includes(p.brand.toLowerCase()) ? `${p.name} · ${p.brand}` : p.name;
  return sheet(title || tr('Product'), (close) => {
    const { seg, note } = modeControl();
    const body = h('div', { class: 'scan-product' }, seg, note);

    // No calories in the database: type them for what was eaten.
    if (!p.per100) {
      const kcal = h('input', { class: 'custom-kcal', id: 'scan-kcal', type: 'text', inputmode: 'numeric', placeholder: '0', 'aria-label': tr('Calories') });
      const add = () => {
        const k = parseNum(kcal.value);
        if (!(k > 0)) { toast(tr('Write how many calories')); kcal.focus(); return; }
        commitCustom(ctx.meal, ctx.day, { name: p.name, kcal: k }, { item: ctx.item, close });
      };
      body.append(
        h('p', { class: 'muted small' }, tr('This product has no calorie data. Enter the calories for the amount you ate.')),
        h('label', { class: 'scan-qty' }, h('span', null, tr('Calories')), kcal),
        h('button', { type: 'button', class: 'btn btn-primary btn-block', id: 'scan-add', onclick: add }, icon('plus', 16), tr('Add')));
      return body;
    }

    const modes = amountModes(p);
    const label = {
      grams: tr('By weight'),
      serving: tr('By servings'),
      package: tr('Whole product'),
    };
    const hint = {
      grams: () => tr('Grams'),
      serving: () => tr('Servings of {0} g', fmt(p.servingG, 1)),
      package: () => tr('Packages of {0} g', fmt(p.packageG, 1)),
    };
    let mode = modes[0];
    const qty = h('input', { class: 'scan-qty-in', id: 'scan-qty', type: 'text', inputmode: 'decimal', 'aria-label': tr('How much did you eat?') });
    const qtyLabel = h('span', null);
    const sum = h('p', { class: 'scan-sum num', role: 'status', 'aria-live': 'polite' });
    const chips = h('div', { class: 'scan-modes', role: 'radiogroup', 'aria-label': tr('How much did you eat?') });
    const defaults = { grams: p.servingG || 100, serving: 1, package: 1 };

    const read = () => amountGrams(p, mode, parseNum(qty.value));
    const draw = () => {
      const g = read();
      const n = nutritionFor(p, g);
      sum.textContent = g > 0 ? tr('{0} g · {1} kcal · P {2} · C {3} · F {4}', fmt(g, 1), fmt(n.kcal), fmt(n.p, 1), fmt(n.c, 1), fmt(n.f, 1)) : '';
    };
    const pick = (m) => {
      mode = m;
      qty.value = String(defaults[m]);
      qtyLabel.textContent = hint[m]();
      clear(chips);
      for (const x of modes) {
        chips.appendChild(h('button', { type: 'button', role: 'radio', 'aria-checked': x === mode ? 'true' : 'false', 'data-amount': x, class: 'custom-mode-btn' + (x === mode ? ' on' : ''), onclick: () => pick(x) }, label[x]));
      }
      draw();
    };
    qty.addEventListener('input', draw);
    pick(mode);

    const add = () => {
      const g = read();
      if (!(g > 0)) { toast(tr('Write how much you ate')); qty.focus(); return; }
      const n = nutritionFor(p, g);
      commitCustom(ctx.meal, ctx.day, { name: p.name, kcal: n.kcal, p: n.p, c: n.c, f: n.f, fi: n.fi, su: n.su, na: n.na, note: tr('{0} g', fmt(g, 1)) }, { item: ctx.item, close });
    };
    qty.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

    body.append(
      h('p', { class: 'muted small num' }, tr('Per 100 g: {0} kcal · P {1} · C {2} · F {3}', p.per100.kcal, fmt(p.per100.p, 1), fmt(p.per100.c, 1), fmt(p.per100.f, 1))),
      h('h4', { class: 'extra-group' }, tr('How much did you eat?')),
      chips,
      h('label', { class: 'scan-qty' }, qtyLabel, qty),
      sum,
      h('button', { type: 'button', class: 'btn btn-primary btn-block', id: 'scan-add', onclick: add }, icon('plus', 16), tr('Add')),
      CREDIT());
    return body;
  });
}
