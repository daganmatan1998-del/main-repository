// Camera / gallery picker. Two separate inputs: `capture` opens the camera
// directly on phones; the plain one opens the photo library, which is the
// fallback when camera permission is denied or there is no camera.
// (With Capacitor, replace with @capacitor/camera's getPhoto().)

import { t as tr } from '../i18n.js';
import { h, icon, sheet, toast } from '../util.js';
import { compressImage, ImageError } from '../image.js';

export function photoButtons(onPicked, { busyText = tr('Processing the photo…'), process = compressImage, front = false, hint = true } = {}) {
  const status = h('p', { class: 'muted small center', 'aria-live': 'polite' });
  const make = (capture) => {
    const input = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
    if (capture) input.setAttribute('capture', front ? 'user' : 'environment');
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      status.textContent = busyText;
      wrap.classList.add('busy');
      try {
        const img = await process(file);
        status.textContent = '';
        await onPicked(img);
      } catch (e) {
        status.textContent = e instanceof ImageError ? e.message : tr('Something went wrong processing the photo. Try again.');
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
    h('button', { type: 'button', class: 'btn btn-primary btn-lg btn-block', id: 'btn-camera', onclick: () => cam.click() }, icon('camera'), tr('Take a photo now')),
    h('button', { type: 'button', class: 'btn btn-lg btn-block', id: 'btn-gallery', onclick: () => gal.click() }, icon('image'), tr('Choose from the gallery')),
    hint ? h('p', { class: 'muted small center' }, tr('No access to the camera? You can choose an existing photo from the gallery.')) : null,
    status, cam, gal);
  return wrap;
}

export function pickPhoto() {
  return new Promise((resolve) => {
    let done = false;
    sheet(tr('Progress photo'), (close) => photoButtons(async (img) => {
      done = true;
      resolve(img);
      close();
      toast(tr('The photo was added'));
    }), { onClose: () => { if (!done) resolve(null); } });
  });
}
