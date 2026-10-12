// Nutrition assistant chat.

import { t as tr } from '../i18n.js';
import { h, icon, clear, confirmDialog } from '../util.js';
import { disclaimer } from '../components.js';
import { state, saveChat } from '../store.js';
import { ask, buildContext } from '../chat.js';
import { ROLE_LABEL } from '../foods.js';
import { aiStatus } from '../store.js';
import { canUseAI } from '../billing.js';
import { openPaywall } from './paywall.js';

let pendingAsk = null; // { text, extra, local } queued by a "replace" button elsewhere
let inFlight = false;

const QUICK = [
  tr('What can I eat instead of the carb at lunch?'),
  tr('An idea for a quick dinner that fits my menu'),
  tr('What should I eat before a workout?'),
  tr('How do I reach my daily protein target?'),
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
    text: tr('Give me substitutes for {0} g of {1} ({2}) at {3}, with exact amounts.', res.source.grams, res.source.name, role, meal.name),
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
  if (!res.options.length) return tr('I couldn\'t find a suitable substitute in the database for your restrictions.');
  const lines = res.options.map((o) => tr('- **{0}** — {1} g ({2}), {3} kcal', o.name, o.grams, o.household, o.kcal));
  return tr('Instead of {0} g of {1} ({2} kcal):\n{3}\n\nThe amounts are calculated to match the same amount of {4}.', res.source.grams, res.source.name, res.source.kcal, lines.join('\n'), { p: tr('Protein'), c: tr('Carbs'), f: tr('Fat'), kcal: tr('Calories') }[res.matchedOn]);
}

export function renderAssistant(root) {
  const messages = state.chat.slice();
  const log = h('div', { class: 'chat-log', id: 'chat-log', 'aria-live': 'polite' });
  const input = h('textarea', { id: 'chat-input', rows: 1, placeholder: tr('Ask about substitutes, meals, amounts…'), 'aria-label': tr('Message to the assistant'), enterkeyhint: 'send' });
  const sendBtn = h('button', { class: 'send-btn', id: 'chat-send', 'aria-label': tr('Send') }, icon('send'));

  const bubble = (m) => {
    const b = h('div', { class: `msg ${m.role}${m.error ? ' error' : ''}${m.local ? ' local' : ''}` });
    if (m.role === 'assistant') b.innerHTML = renderText(m.content);
    else b.textContent = m.content;
    if (m.local) b.appendChild(h('small', { class: 'muted' }, tr('Thinking on your device (the online assistant is unavailable)')));
    return b;
  };

  const drawLog = () => {
    clear(log);
    if (!messages.length) {
      log.appendChild(h('div', { class: 'chat-empty' },
        h('div', { class: 'chat-avatar' }, icon('sparkle', 28)),
        h('p', null, tr('Hi! I\'m your nutrition assistant. I know your menu, targets and restrictions.')),
        h('p', { class: 'muted small' }, tr('You can also tap "Swap" next to any item in the menu.'))));
    }
    messages.forEach((m) => log.appendChild(bubble(m)));
    if (inFlight) log.appendChild(h('div', { class: 'msg assistant typing', 'aria-label': tr('The assistant is typing') }, h('i'), h('i'), h('i')));
    requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; window.scrollTo(0, document.body.scrollHeight); });
  };

  async function send(text, extra = {}, local = null) {
    text = text.trim();
    if (!text || inFlight) return;
    // The assistant is a paid feature after the trial. A substitution question
    // still gets the answer computed on the device (no AI involved).
    if (!canUseAI(aiStatus())) {
      if (local) {
        messages.push({ role: 'user', content: text, at: Date.now() }, { role: 'assistant', content: localAnswer(local), at: Date.now(), local: true });
        await saveChat(messages.filter((m) => !m.error));
        drawLog();
      }
      openPaywall('chat');
      return;
    }
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
        const why = e.code === 'offline' ? tr('No internet connection — the assistant works only online. The menu and the "Swap" buttons also work without a connection.')
          : e.code === 'not_configured' ? tr('The assistant is not available yet. Try again later.')
            : e.code === 'rate_limited' ? tr('Too many requests. Try again in a minute.')
              : e.code === 'all_engines_busy' ? tr('The assistant is busy right now. Try again in a few minutes.')
              : tr('The assistant is unavailable right now. Try again in a moment.');
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
    h('div', null, h('h1', null, tr('Nutrition assistant')), h('p', { class: 'muted' }, tr('Short, practical answers'))),
    h('button', {
      class: 'icon-btn',
      'aria-label': tr('Clear the chat'),
      onclick: async () => {
        if (!messages.length) return;
        if (await confirmDialog(tr('Clear the chat'), tr('Delete the chat history?'), tr('Delete'), true)) {
          messages.length = 0;
          await saveChat([]);
          drawLog();
        }
      },
    }, icon('trash'))));
  root.appendChild(disclaimer());
  const access = aiStatus();
  if (access.state !== 'active') {
    root.appendChild(h('div', { class: `notice ${access.state === 'locked' ? 'warn' : 'ok'} small ai-plan`, id: 'ai-plan' },
      icon(access.state === 'locked' ? 'lock' : 'sparkle', 16),
      h('span', null, access.state === 'locked' ? tr('The smart assistant is available with a Nutri Plus plan.') : tr('Trial: {0, plural, one {# more day} other {# more days}} of the smart assistant for free.', access.daysLeft)),
      h('button', { class: 'btn btn-small', onclick: () => openPaywall('chat') }, access.state === 'locked' ? tr('Open') : tr('Details'))));
  }
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
