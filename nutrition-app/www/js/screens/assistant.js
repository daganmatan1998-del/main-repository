// Nutrition assistant chat.

import { h, icon, clear, confirmDialog } from '../util.js';
import { disclaimer } from '../components.js';
import { state, saveChat } from '../store.js';
import { ask, buildContext } from '../chat.js';
import { ROLE_LABEL } from '../foods.js';

let pendingAsk = null; // { text, extra, local } queued by a "replace" button elsewhere
let inFlight = false;

const QUICK = [
  'מה אפשר לאכול במקום הפחמימה בארוחת הצהריים?',
  'רעיון לארוחת ערב מהירה שמתאימה לתפריט שלי',
  'מה כדאי לאכול לפני אימון?',
  'איך לעמוד ביעד החלבון היומי?',
];

// Called from meal cards: opens the assistant with a pre-filled substitution
// question and the locally computed equivalents as grounding.
// Any screen can open the assistant with a ready question (e.g. a recipe idea).
export function queueAsk(text, extra = {}) {
  pendingAsk = { text, extra, local: null };
  location.hash = '#/assistant';
}

export function queueSubstitution(item, meal, res) {
  const role = ROLE_LABEL[item.role];
  pendingAsk = {
    text: `תן לי תחליפים ל-${res.source.grams} ג׳ ${res.source.name} (${role}) ב${meal.name}, עם כמויות מדויקות.`,
    extra: { substitutionRequest: { meal: meal.name, item: res.source, matchedOn: res.matchedOn, computedEquivalents: res.options.map(({ score, ...o }) => o) } },
    local: res,
  };
  location.hash = '#/assistant';
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Tiny, safe markdown: escape first, then bold and bullet lists.
function renderText(text) {
  const lines = escapeHtml(text).split('\n');
  let html = '';
  let inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    const m = line.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (m) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${m[1]}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += line.trim() ? `<p>${line}</p>` : '';
    }
  }
  if (inList) html += '</ul>';
  return html;
}

function localAnswer(res) {
  if (!res.options.length) return 'לא מצאתי תחליף מתאים במאגר עבור ההגבלות שלך.';
  const lines = res.options.map((o) => `- **${o.name}** — ${o.grams} ג׳ (${o.household}), ${o.kcal} קק״ל`);
  return `במקום ${res.source.grams} ג׳ ${res.source.name} (${res.source.kcal} קק״ל):\n${lines.join('\n')}\n\nהכמויות מחושבות לפי אותה כמות ${{ p: 'חלבון', c: 'פחמימות', f: 'שומן', kcal: 'קלוריות' }[res.matchedOn]}.`;
}

export function renderAssistant(root) {
  const messages = state.chat.slice();
  const log = h('div', { class: 'chat-log', id: 'chat-log', 'aria-live': 'polite' });
  const input = h('textarea', { id: 'chat-input', rows: 1, placeholder: 'שאלו על תחליפים, ארוחות, כמויות…', 'aria-label': 'הודעה לעוזר', enterkeyhint: 'send' });
  const sendBtn = h('button', { class: 'send-btn', id: 'chat-send', 'aria-label': 'שליחה' }, icon('send'));

  const bubble = (m) => {
    const b = h('div', { class: `msg ${m.role}${m.error ? ' error' : ''}${m.local ? ' local' : ''}` });
    if (m.role === 'assistant') b.innerHTML = renderText(m.content);
    else b.textContent = m.content;
    if (m.local) b.appendChild(h('small', { class: 'muted' }, 'חושב במכשיר (העוזר המקוון לא זמין)'));
    return b;
  };

  const drawLog = () => {
    clear(log);
    if (!messages.length) {
      log.appendChild(h('div', { class: 'chat-empty' },
        h('div', { class: 'chat-avatar' }, icon('sparkle', 28)),
        h('p', null, 'שלום! אני העוזר התזונתי שלך. אני מכיר את התפריט, היעדים וההגבלות שלך.'),
        h('p', { class: 'muted small' }, 'אפשר גם ללחוץ על "החלף" ליד כל פריט בתפריט.')));
    }
    messages.forEach((m) => log.appendChild(bubble(m)));
    if (inFlight) log.appendChild(h('div', { class: 'msg assistant typing', 'aria-label': 'העוזר כותב' }, h('i'), h('i'), h('i')));
    requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; window.scrollTo(0, document.body.scrollHeight); });
  };

  async function send(text, extra = {}, local = null) {
    text = text.trim();
    if (!text || inFlight) return;
    messages.push({ role: 'user', content: text, at: Date.now() });
    inFlight = true;
    sendBtn.disabled = true;
    drawLog();
    try {
      const history = messages.filter((m) => !m.error).slice(-12);
      const reply = await ask(history, buildContext(extra));
      messages.push({ role: 'assistant', content: reply, at: Date.now() });
    } catch (e) {
      if (local) {
        messages.push({ role: 'assistant', content: localAnswer(local), at: Date.now(), local: true });
      } else {
        const why = e.code === 'offline' ? 'אין חיבור לאינטרנט — העוזר זמין רק אונליין. התפריט וההחלפות בכפתורי "החלף" עובדים גם בלי חיבור.'
          : e.code === 'not_configured' ? 'העוזר עוד לא הוגדר בשרת (חסר מפתח API). ראו הוראות התקנה ב-README.'
            : e.code === 'rate_limited' ? 'יותר מדי בקשות. נסו שוב בעוד דקה.'
              : 'העוזר לא זמין כרגע. נסו שוב בעוד רגע.';
        messages.push({ role: 'assistant', content: why, at: Date.now(), error: true });
      }
    } finally {
      inFlight = false;
      sendBtn.disabled = false;
      await saveChat(messages.filter((m) => !m.error));
      if (log.isConnected) drawLog();
    }
  }

  sendBtn.addEventListener('click', () => { const v = input.value; input.value = ''; autosize(); send(v); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click(); }
  });
  const autosize = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 120)}px`; };
  input.addEventListener('input', autosize);

  root.appendChild(h('header', { class: 'page-head' },
    h('div', null, h('h1', null, 'עוזר תזונה'), h('p', { class: 'muted' }, 'תשובות קצרות ומעשיות')),
    h('button', {
      class: 'icon-btn',
      'aria-label': 'ניקוי השיחה',
      onclick: async () => {
        if (!messages.length) return;
        if (await confirmDialog('ניקוי השיחה', 'למחוק את היסטוריית השיחה?', 'מחיקה', true)) {
          messages.length = 0;
          await saveChat([]);
          drawLog();
        }
      },
    }, icon('trash'))));
  root.appendChild(disclaimer());
  root.appendChild(log);
  root.appendChild(h('div', { class: 'quick-row' },
    ...QUICK.map((q) => h('button', { class: 'chip', onclick: () => send(q) }, q))));
  root.appendChild(h('div', { class: 'composer' }, input, sendBtn));
  drawLog();

  if (pendingAsk) {
    const p = pendingAsk;
    pendingAsk = null;
    send(p.text, p.extra, p.local);
  }
}
