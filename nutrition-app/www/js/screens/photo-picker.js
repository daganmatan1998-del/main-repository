// Camera / gallery picker. Two separate inputs: `capture` opens the camera
// directly on phones; the plain one opens the photo library, which is the
// fallback when camera permission is denied or there is no camera.
// (With Capacitor, replace with @capacitor/camera's getPhoto().)

import { h, icon, sheet, toast } from '../util.js';
import { compressImage, ImageError } from '../image.js';

export function photoButtons(onPicked, { busyText = 'מעבד תמונה…' } = {}) {
  const status = h('p', { class: 'muted small center', 'aria-live': 'polite' });
  const make = (capture) => {
    const input = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
    if (capture) input.setAttribute('capture', 'environment');
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      status.textContent = busyText;
      wrap.classList.add('busy');
      try {
        const img = await compressImage(file);
        status.textContent = '';
        await onPicked(img);
      } catch (e) {
        status.textContent = e instanceof ImageError ? e.message : 'משהו השתבש בעיבוד התמונה. נסו שוב.';
        if (!(e instanceof ImageError)) console.error(e);
      } finally {
        wrap.classList.remove('busy');
      }
    });
    return input;
  };
  const cam = make(true);
  const gal = make(false);
  const wrap = h('div', { class: 'photo-buttons' },
    h('button', { type: 'button', class: 'btn btn-primary btn-lg btn-block', id: 'btn-camera', onclick: () => cam.click() }, icon('camera'), 'צילום עכשיו'),
    h('button', { type: 'button', class: 'btn btn-lg btn-block', id: 'btn-gallery', onclick: () => gal.click() }, icon('image'), 'בחירה מהגלריה'),
    h('p', { class: 'muted small center' }, 'אין גישה למצלמה? אפשר לבחור תמונה קיימת מהגלריה.'),
    status, cam, gal);
  return wrap;
}

export function pickPhoto() {
  return new Promise((resolve) => {
    let done = false;
    sheet('תמונת התקדמות', (close) => photoButtons(async (img) => {
      done = true;
      resolve(img);
      close();
      toast('התמונה נוספה');
    }), { onClose: () => { if (!done) resolve(null); } });
  });
}
