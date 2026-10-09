// Client-side image compression for progress photos.
// Phone cameras produce 3–12 MB images; storing those for every week would
// fill the device quota within months. We downscale to 1600 px on the long
// side and re-encode as JPEG, which lands around 150–400 KB.

const MAX_SIDE = 1600;
const TARGET_BYTES = 600 * 1024;

export class ImageError extends Error {}

async function decode(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* fall through to <img>, which handles more formats on some browsers */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

export async function compressImage(file) {
  if (!file) throw new ImageError('לא נבחר קובץ.');
  if (file.type && !file.type.startsWith('image/')) throw new ImageError('הקובץ שנבחר אינו תמונה.');
  if (file.size > 40 * 1024 * 1024) throw new ImageError('התמונה גדולה מדי (מעל 40MB).');

  let src;
  try {
    src = await decode(file);
  } catch {
    throw new ImageError('לא ניתן לפתוח את התמונה. נסו לצלם שוב או לבחור תמונה בפורמט JPEG/PNG.');
  }
  const w0 = src.width || src.naturalWidth;
  const h0 = src.height || src.naturalHeight;
  if (!w0 || !h0) throw new ImageError('התמונה ריקה או פגומה.');

  let side = MAX_SIDE;
  let quality = 0.82;
  for (let attempt = 0; attempt < 4; attempt++) {
    const scale = Math.min(1, side / Math.max(w0, h0));
    const w = Math.round(w0 * scale);
    const h = Math.round(h0 * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0, w, h);
    const blob = await toBlob(canvas, quality);
    if (!blob) throw new ImageError('דחיסת התמונה נכשלה.');
    if (blob.size <= TARGET_BYTES || attempt === 3) {
      if (src.close) src.close();
      return { blob, width: w, height: h, originalBytes: file.size };
    }
    side = Math.round(side * 0.8);
    quality = Math.max(0.6, quality - 0.08);
  }
  throw new ImageError('דחיסת התמונה נכשלה.');
}
