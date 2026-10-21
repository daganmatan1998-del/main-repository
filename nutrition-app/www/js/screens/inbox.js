// Inbox: two folders. "Messages" — everything the app has told the person;
// "Friend requests" — people who asked to be friends (and the ones we asked).

import { t as tr, locale } from '../i18n.js';
import { h, icon, clear, toast, fmtDate, dayKey } from '../util.js';
import * as cloud from '../cloud.js';
import * as social from '../social.js';
import { GOALS } from '../nutrition.js';
import { messages, markRead, markAllRead, setWaitingRequests, removeMessage } from '../inbox.js';
import { googleButton } from './account.js';
import { loadRelations, forgetRelations, personRow, failed } from './friends.js';
import { challengeInvitations } from './challenges.js';
import * as ch from '../challenges.js';
import { challengeList, refreshChallenges } from '../challenge-sync.js';

// Title, text and where tapping leads — written in the current language when shown.
const KINDS = {
  welcome: () => ({ title: tr('Welcome to Nutri 👋'), text: tr('Your plan is ready. Open Today to see your first menu.'), link: '#/today' }),
  'checkin-due': (a) => ({ title: tr('Your weekly check-in is ready'), text: tr('Week {0}: add a progress photo (or skip it) and update your weight.', a[0]), link: '#/today' }),
  'period-ended': (a) => ({ title: tr('Your {0} period is over 🎉', (GOALS[a[0]] || { label: '' }).label), text: tr('Time to review your results and set up the next period.'), link: '#/today' }),
  'friend-accepted': (a) => ({ title: tr('{0} accepted your friend request', a[0]), text: tr('You are now friends.'), link: '' }),
  'challenge-accepted': (a) => ({ title: tr('{0} accepted your challenge', a[0]), text: tr('It starts tomorrow. Mark every meal before the day ends.') }),
  'challenge-declined': (a) => ({ title: tr('{0} declined your challenge', a[0]), text: tr('You can challenge another friend any time.') }),
  'challenge-won': (a) => ({ title: tr('You won the challenge against {0} 🎉', a[0]), text: tr('Your record was updated.') }),
  'challenge-lost': (a) => ({ title: tr('{0} won the challenge', a[0]), text: tr('Your record was updated.') }),
  'emblem-earned': (a) => ({ title: tr('New emblem: {0}', a[0]), text: tr('Add it above your profile picture from your profile.'), link: '#/profile' }),
  'badge-earned': (a) => ({ title: tr('New badge: {0}', a[0]), text: tr('See all your achievements on your profile.'), link: '#/profile' }),
  'challenge-draw': (a) => ({ title: tr('The challenge with {0} ended in a draw', a[0]), text: tr('Nobody\'s record changed.') }),
};
const describe = (m) => (KINDS[m.kind] ? KINDS[m.kind](m.args || []) : null);

function ago(at) {
  const min = Math.round((Date.now() - at) / 60000);
  if (min < 1) return tr('now');
  if (min < 60) return tr('{0} min ago', min);
  const d = new Date(at);
  return `${fmtDate(dayKey(d))} ${d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`;
}

let folder = 'messages';

export function renderInbox(root) {
  clear(root);
  const unreadAtOpen = new Set(messages().filter((m) => !m.read).map((m) => m.id));
  const body = h('div', { id: 'inbox-body' });
  const tabs = h('div', { class: 'inbox-tabs', role: 'tablist' });

  const drawTabs = (requests) => {
    clear(tabs);
    for (const [id, label, n] of [['messages', tr('Messages'), unreadAtOpen.size], ['requests', tr('Friend requests'), requests]]) {
      tabs.appendChild(h('button', {
        type: 'button', role: 'tab', id: `tab-${id}`, 'aria-selected': folder === id ? 'true' : 'false', class: 'inbox-tab' + (folder === id ? ' on' : ''),
        onclick: () => { folder = id; renderInbox(root); },
      }, label, n ? h('span', { class: 'count' }, String(n)) : null));
    }
  };
  let waiting = 0;
  drawTabs(waiting);

  root.append(
    h('header', { class: 'page-head' },
      h('div', { class: 'grow' }, h('h1', null, tr('Inbox'))),
      folder === 'messages' && messages().length ? h('button', { type: 'button', class: 'btn btn-ghost btn-small', id: 'inbox-read-all', onclick: async () => { await markAllRead(); unreadAtOpen.clear(); renderInbox(root); } }, tr('Mark all as read')) : null),
    tabs, body);

  if (folder === 'messages') { drawMessages(body, unreadAtOpen); markAllRead(); } else drawRequests(body, (n) => { waiting = n; drawTabs(n); });
  // The request count shows on its tab even while the messages folder is open.
  if (folder === 'messages' && cloud.cloudReady() && cloud.signedIn()) {
    loadRelations().then((rel) => { if (document.body.contains(tabs)) drawTabs(rel.incoming.length + ch.invitations(challengeList()).length); }).catch(() => {});
  }
}

function drawMessages(body, unread) {
  const list = messages().map((m) => ({ m, d: describe(m) })).filter((x) => x.d);
  if (!list.length) { body.appendChild(h('p', { class: 'empty', id: 'inbox-empty' }, tr('No messages yet.'))); return; }
  body.appendChild(h('ul', { class: 'inbox-list', id: 'inbox-list' }, ...list.map(({ m, d }) => h('li', { class: 'inbox-item' + (unread.has(m.id) ? ' unread' : ''), 'data-kind': m.kind },
    h('a', { class: 'inbox-main', href: m.link || d.link || '#/inbox', onclick: () => markRead(m.id) },
      h('b', null, d.title),
      h('span', { class: 'small' }, d.text),
      h('small', { class: 'muted' }, ago(m.at))),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': tr('Delete message'), onclick: async (e) => { e.preventDefault(); await removeMessage(m.id); renderInbox(document.getElementById('view')); } }, icon('close', 16))))));
}

function drawRequests(body, onCount) {
  if (!cloud.cloudReady()) { body.appendChild(h('p', { class: 'empty' }, tr('Friend requests will appear here.'))); return; }
  if (!cloud.signedIn()) {
    body.append(h('p', { class: 'empty' }, tr('Sign in to receive friend requests.')), googleButton(tr('Sign in with Google'), { id: 'btn-google-inbox', primary: true }));
    return;
  }
  body.appendChild(h('p', { class: 'muted' }, tr('Loading…')));
  loadRelations(true).then(async (rel) => {
    await refreshChallenges();
    if (!document.body.contains(body)) return;
    clear(body);
    onCount(rel.incoming.length + ch.invitations(challengeList()).length);
    setWaitingRequests(rel.incoming.length);
    const act = async (fn, okText) => {
      try { await fn(); if (okText) toast(okText); forgetRelations(); renderInbox(document.getElementById('view')); } catch { toast(tr('Couldn\'t reach the server. Try again.')); }
    };
    const invites = challengeInvitations(body, () => renderInbox(document.getElementById('view')));
    if (!rel.incoming.length && !rel.outgoing.length && !invites) { body.appendChild(h('p', { class: 'empty', id: 'requests-empty' }, tr('No friend requests.'))); return; }
    if (rel.incoming.length) {
      body.append(h('h3', { class: 'extra-group' }, tr('Received')),
        h('ul', { class: 'friend-list', id: 'requests-in' }, ...rel.incoming.map((e) => personRow(e.user,
          h('div', { class: 'friend-actions' },
            h('button', { type: 'button', class: 'btn btn-small btn-primary', 'data-act': 'accept', onclick: () => act(() => social.respond(e.id, 'accepted'), tr('You are now friends with {0}', e.user.display_name || e.user.username)) }, tr('Accept')),
            h('button', { type: 'button', class: 'btn btn-small', 'data-act': 'decline', onclick: () => act(() => social.respond(e.id, 'declined'), tr('Request declined')) }, tr('Decline')))))));
    }
    if (rel.outgoing.length) {
      body.append(h('h3', { class: 'extra-group' }, tr('Sent')),
        h('ul', { class: 'friend-list', id: 'requests-out' }, ...rel.outgoing.map((e) => personRow(e.user,
          h('div', { class: 'friend-actions' },
            h('button', { type: 'button', class: 'btn btn-small btn-ghost', 'data-act': 'cancel', onclick: () => act(() => social.removeRequest(e.id), tr('Request cancelled')) }, tr('Cancel request')))))));
    }
  }).catch((e) => { clear(body); body.appendChild(h('p', { class: 'notice warn' }, failed(e))); });
}
