// "Don't know your body fat?" — guided four-angle photo capture (front, left,
// back, right) with a self-timer, then an estimate from /api/bodyfat.
// Falls back to file upload when there is no camera, and to the US Navy tape
// method or a BMI formula when the analysis is unavailable.
//
// Photos live only in memory here: they are sent once for analysis and are
// never saved on the device or on the server.

import { h, icon, clear, parseNum } from '../util.js';
import { API_BASE } from '../config.js';
import { deurenberg, navy, combine } from '../bodyfat.js';

const ANGLES = [
  { id: 'front', label: 'מקדימה', hint: 'פנים למצלמה, ידיים מעט רחוקות מהגוף' },
  { id: 'left', label: 'צד שמאל', hint: 'הצד השמאלי אל המצלמה, ידיים לצד הגוף או משולבות על החזה' },
  { id: 'back', label: 'מאחור', hint: 'גב למצלמה, ידיים מעט רחוקות מהגוף' },
  { id: 'right', label: 'צד ימין', hint: 'הצד הימני אל המצלמה' },
];

const CONFIDENCE = { low: 'נמוכה', medium: 'בינונית', high: 'גבוהה' };
const METHOD = {
  ai: 'ניתוח תמונות (AI)',
  'ai+tape': 'ניתוח תמונות + מדידות סרט',
  tape: 'מדידות סרט (שיטת הצי האמריקאי)',
  bmi: 'נוסחה לפי BMI וגיל (הערכה גסה)',
};

export const DISCLAIMER = 'אין התחייבות לדיוק המספרים. זו הערכה בלבד, והיא עלולה לסטות בכמה אחוזים. למספר מדויק מומלץ להתייעץ עם תזונאי/ת או לבצע מדידה מקצועית (קליפר / DEXA).';

function silhouette(angle) {
  const side = angle === 'left' || angle === 'right';
  const body = side
    ? '<ellipse cx="50" cy="13" rx="7" ry="8"/><path d="M47 21 C40 26 41 40 43 52 C44 60 42 70 43 84 L45 128 M53 21 C60 28 59 40 57 52 C56 60 58 70 57 84 L55 128"/>'
    : '<ellipse cx="50" cy="13" rx="8" ry="9"/><path d="M42 22 C30 25 27 30 25 40 L21 72 M58 22 C70 25 73 30 75 40 L79 72 M36 28 C35 48 36 60 38 72 L37 128 M64 28 C65 48 64 60 62 72 L63 128 M50 74 L50 128"/>';
  const span = document.createElement('span');
  span.className = 'bf-guide';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 100 132" preserveAspectRatio="xMidYMid meet" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="3 2.5" stroke-linecap="round">${body}</svg>`;
  return span;
}

// Downscales a frame (video, image or bitmap) to a JPEG and returns base64.
async function toJpeg(source, w, h, maxSide = 1024) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { b64: btoa(s), url: URL.createObjectURL(blob) };
}

async function fileToJpeg(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  if (bmp) return toJpeg(bmp, bmp.width, bmp.height);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return toJpeg(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

let audio;
function beep(freq = 880, ms = 90) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = freq;
    g.gain.value = 0.08;
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + ms / 1000);
  } catch { /* sound is a nicety */ }
}

// person: { sex, age, height, weight }. Resolves to the chosen % or null.
export function openBodyFatEstimator(person) {
  return new Promise((resolve) => {
    const el = h('div', { class: 'overlay bf keep', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'הערכת אחוז שומן' });
    const body = h('div', { class: 'bf-body' });
    const photos = {}; // angle -> { b64, url }
    let stream = null;
    let facing = 'user';
    let timer = 5;
    let settled = false;

    const stopCamera = () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null;
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      stopCamera();
      Object.values(photos).forEach((p) => URL.revokeObjectURL(p.url));
      el.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') finish(null); };
    document.addEventListener('keydown', onKey);

    const header = (title) => h('div', { class: 'bf-head' },
      h('h2', null, title),
      h('button', { class: 'icon-btn', 'aria-label': 'סגירה', onclick: () => finish(null) }, icon('close', 24)));

    const prior = deurenberg(person);

    // ---------- step 0: intro + consent ----------
    function intro() {
      stopCamera();
      clear(body);
      const consent = h('input', { type: 'checkbox', id: 'bf-consent' });
      const start = h('button', { class: 'btn btn-primary btn-lg btn-block', id: 'bf-start', disabled: true, onclick: () => capture(0) }, icon('camera'), 'התחלת צילום (4 תמונות)');
      consent.addEventListener('change', () => { start.disabled = !consent.checked; });
      body.append(
        header('הערכת אחוז שומן מתמונות'),
        h('p', { class: 'lead' }, 'נצלם 4 תמונות — מקדימה, צד שמאל, מאחור וצד ימין — ונעריך את אחוז השומן לפיהן.'),
        h('ul', { class: 'tips' },
          h('li', null, 'בגדים צמודים או בגד ים — בגדים רחבים מסתירים את קווי הגוף'),
          h('li', null, 'מקום מואר, רקע פשוט'),
          h('li', null, 'הניחו את הטלפון בגובה המותניים, 2–2.5 מטר מכם, כך שכל הגוף בתוך המסגרת'),
          h('li', null, 'יש טיימר — יש זמן להתרחק ולעמוד בתנוחה')),
        h('div', { class: 'notice warn small' }, DISCLAIMER),
        h('label', { class: 'bf-consent' }, consent,
          h('span', null, 'אני מסכים/ה שהתמונות יישלחו לניתוח AI (Anthropic) דרך השרת של האפליקציה. הן לא נשמרות בשרת ולא באפליקציה.')),
        start,
        h('button', { class: 'btn btn-ghost btn-block', id: 'bf-no-photos', onclick: () => measurements(false) }, 'אין לי איך לצלם — הערכה לפי מדידות / משקל וגובה'));
    }

    // ---------- steps 1–4: capture ----------
    async function capture(i) {
      const angle = ANGLES[i];
      clear(body);
      const video = h('video', { class: 'bf-video' + (facing === 'user' ? ' mirror' : ''), playsinline: true, muted: true, autoplay: true });
      video.muted = true;
      const count = h('div', { class: 'bf-count', 'aria-live': 'assertive' });
      const stage = h('div', { class: 'bf-stage' }, video, silhouette(angle.id), count);
      const status = h('p', { class: 'muted small center', 'aria-live': 'polite' });
      const fileInput = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true', id: 'bf-file' });
      fileInput.addEventListener('change', async () => {
        const f = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (!f) return;
        status.textContent = 'מעבד…';
        try {
          photos[angle.id] = await fileToJpeg(f);
          review(i);
        } catch {
          status.textContent = 'לא ניתן לפתוח את הקובץ. נסו תמונה אחרת.';
        }
      });
      const shoot = h('button', { class: 'btn btn-primary btn-lg grow', id: 'bf-shoot' }, icon('camera'), `צילום (טיימר ${timer} שנ׳)`);
      const timerSeg = h('div', { class: 'segmented small', role: 'radiogroup', 'aria-label': 'טיימר' },
        ...[3, 5, 10].map((s) => h('button', {
          type: 'button', role: 'radio', 'aria-checked': timer === s ? 'true' : 'false', class: timer === s ? 'on' : '',
          onclick: (e) => {
            timer = s;
            timerSeg.querySelectorAll('button').forEach((b) => { b.classList.remove('on'); b.setAttribute('aria-checked', 'false'); });
            e.currentTarget.classList.add('on');
            e.currentTarget.setAttribute('aria-checked', 'true');
            shoot.lastChild.textContent = `צילום (טיימר ${timer} שנ׳)`;
          },
        }, `${s} שנ׳`)));

      body.append(
        header(`צילום ${i + 1} מתוך 4: ${angle.label}`),
        h('div', { class: 'bf-dots' }, ...ANGLES.map((a, k) => h('span', { class: (k < i ? 'done' : k === i ? 'on' : '') }))),
        h('p', { class: 'small center' }, angle.hint),
        stage,
        h('div', { class: 'row gap bf-controls' },
          shoot,
          h('button', { class: 'icon-btn bf-flip', 'aria-label': 'החלפת מצלמה', onclick: () => { facing = facing === 'user' ? 'environment' : 'user'; capture(i); } }, icon('swap'))),
        h('div', { class: 'row gap center-y bf-timer' }, h('span', { class: 'small muted' }, 'טיימר:'), timerSeg),
        h('button', { class: 'btn btn-ghost btn-block', id: 'bf-upload', onclick: () => fileInput.click() }, icon('image', 18), 'העלאת תמונה קיימת במקום'),
        status, fileInput);

      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no camera api');
        if (!stream) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1920 } },
            audio: false,
          });
        }
        video.srcObject = stream;
        await video.play().catch(() => {});
      } catch {
        stopCamera();
        stage.classList.add('nocam');
        stage.appendChild(h('div', { class: 'bf-nocam' },
          h('p', null, 'אין גישה למצלמה מהאפליקציה.'),
          h('p', { class: 'small' }, 'אפשר לצלם עם המצלמה הרגילה (עם טיימר) ולהעלות את התמונה, או לאשר גישה למצלמה בהגדרות הדפדפן.')));
        shoot.disabled = true;
        const camInput = h('input', { type: 'file', accept: 'image/*', capture: 'user', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
        camInput.addEventListener('change', () => { fileInput.files = camInput.files; fileInput.dispatchEvent(new Event('change')); });
        body.appendChild(camInput);
        body.insertBefore(h('button', { class: 'btn btn-primary btn-lg btn-block', onclick: () => camInput.click() }, icon('camera'), 'צילום במצלמת הטלפון'), status);
      }

      shoot.addEventListener('click', async () => {
        if (!stream || !video.videoWidth) { status.textContent = 'המצלמה עוד נטענת…'; return; }
        shoot.disabled = true;
        for (let n = timer; n > 0; n--) {
          count.textContent = String(n);
          count.classList.add('show');
          beep(n === 1 ? 1100 : 760);
          await new Promise((r) => setTimeout(r, 1000));
          if (settled || !count.isConnected) return;
        }
        count.textContent = '';
        count.classList.remove('show');
        beep(1500, 160);
        stage.classList.add('flash');
        photos[angle.id] = await toJpeg(video, video.videoWidth, video.videoHeight);
        review(i);
      });
    }

    function review(i) {
      const angle = ANGLES[i];
      clear(body);
      const last = i === ANGLES.length - 1;
      body.append(
        header(`צילום ${i + 1} מתוך 4: ${angle.label}`),
        h('div', { class: 'bf-stage' }, h('img', { src: photos[angle.id].url, alt: `תמונה ${angle.label}`, class: 'bf-shot' })),
        h('p', { class: 'small center' }, 'כל הגוף בתוך התמונה? רואים את קווי הגוף?'),
        h('div', { class: 'row gap' },
          h('button', { class: 'btn btn-primary btn-lg grow', id: 'bf-keep', onclick: () => (last ? measurements(true) : capture(i + 1)) }, icon('check'), last ? 'המשך לניתוח' : 'הבאה'),
          h('button', { class: 'btn btn-lg', onclick: () => { URL.revokeObjectURL(photos[angle.id].url); delete photos[angle.id]; capture(i); } }, 'צילום חוזר')));
    }

    // ---------- optional tape measurements ----------
    function measurements(withPhotos) {
      stopCamera();
      clear(body);
      const field = (id, label) => h('label', { class: 'field' }, h('span', null, label), h('input', { id, inputmode: 'decimal', placeholder: 'ס״מ' }));
      const fields = h('div', { class: 'grid2' },
        field('bf-waist', 'היקף מותניים (בגובה הטבור)'),
        field('bf-neck', 'היקף צוואר (מתחת לגרוגרת)'),
        person.sex === 'female' ? field('bf-hip', 'היקף ירכיים (בנקודה הרחבה)') : null);
      const go = () => {
        const tape = navy({
          sex: person.sex,
          height: person.height,
          waist: parseNum(body.querySelector('#bf-waist').value),
          neck: parseNum(body.querySelector('#bf-neck').value),
          hip: parseNum(body.querySelector('#bf-hip')?.value),
        });
        analyze(withPhotos, tape);
      };
      body.append(
        header('לדיוק נוסף (לא חובה)'),
        h('p', { class: 'muted' }, 'יש סרט מדידה? שלוש מדידות קצרות משפרות את הדיוק. אין? אפשר לדלג.'),
        fields,
        h('button', { class: 'btn btn-primary btn-lg btn-block', id: 'bf-analyze', onclick: go }, withPhotos ? 'ניתוח' : 'חישוב הערכה'),
        h('button', { class: 'btn btn-ghost btn-block', id: 'bf-skip-tape', onclick: () => analyze(withPhotos, null) }, 'דילוג'));
    }

    // ---------- analysis ----------
    async function analyze(withPhotos, tape) {
      clear(body);
      body.append(header('מנתח…'), h('div', { class: 'bf-wait' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', null, withPhotos ? 'מנתח את התמונות, זה לוקח כחצי דקה…' : 'מחשב…')));
      let ai = null;
      let issue = null;
      let failure = null;
      if (withPhotos) {
        try {
          if (!navigator.onLine) throw new Error('offline');
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 90000);
          const res = await fetch(`${API_BASE}/api/bodyfat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            signal: ctrl.signal,
            body: JSON.stringify({
              photos: ANGLES.filter((a) => photos[a.id]).map((a) => ({ angle: a.id, data: photos[a.id].b64 })),
              profile: { sex: person.sex, age: person.age, heightCm: person.height, weightKg: person.weight, bmiPriorPct: prior },
            }),
          });
          clearTimeout(t);
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || `http_${res.status}`);
          if (data.ok) ai = data;
          else issue = data.issue;
        } catch (e) {
          failure = e.message === 'offline' ? 'אין חיבור לאינטרנט' : e.message === 'not_configured' ? 'שירות הניתוח עוד לא הוגדר בשרת' : 'שירות הניתוח לא זמין כרגע';
        }
      }
      if (settled) return;
      result(combine({ ai, tapeEstimate: tape, prior }), { ai, issue, failure, withPhotos, tape });
    }

    function result(r, { ai, issue, failure, withPhotos, tape }) {
      clear(body);
      const value = Math.round(r.estimate * 2) / 2;
      // Native append() would print a skipped (null) block as the text "null".
      body.append(...[
        header('ההערכה שלך'),
        issue ? h('div', { class: 'notice warn' }, h('p', null, `לא הצלחנו לנתח את התמונות: ${issue}`),
          h('button', { class: 'btn btn-small', onclick: () => capture(0) }, 'צילום מחדש')) : null,
        failure && withPhotos ? h('div', { class: 'notice warn' }, h('p', null, `${failure} — לכן מוצגת הערכה ${r.method === 'tape' ? 'לפי המדידות' : 'גסה לפי משקל, גובה וגיל'}.`),
          h('button', { class: 'btn btn-small', onclick: () => analyze(true, tape) }, 'ניסיון חוזר')) : null,
        h('div', { class: 'bf-result card' },
          h('div', { class: 'bf-big', id: 'bf-value' }, h('span', { class: 'ltr' }, `${value}%`)),
          h('div', { class: 'muted' }, 'טווח סביר: ', h('span', { class: 'ltr' }, `${r.low}%–${r.high}%`)),
          h('div', { class: 'kv' },
            h('span', null, 'שיטה'), h('b', null, METHOD[r.method]),
            h('span', null, 'רמת ביטחון'), h('b', null, CONFIDENCE[r.confidence] || '—')),
          ai && ai.notes ? h('p', { class: 'small' }, ai.notes) : null),
        h('div', { class: 'notice warn small', id: 'bf-disclaimer' }, DISCLAIMER),
        h('button', { class: 'btn btn-primary btn-lg btn-block', id: 'bf-use', onclick: () => finish(value) }, `שימוש ב-${value}%`),
        h('button', { class: 'btn btn-ghost btn-block', onclick: () => finish(null) }, 'הזנה ידנית'),
      ].filter(Boolean));
    }

    el.appendChild(body);
    document.body.appendChild(el);
    intro();
  });
}
