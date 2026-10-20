// Challenges: the sheet that starts one, the page of one challenge (#/challenge/<id>),
// the card in Profile, the strip on Today and the invitations in the inbox.

import { t as tr } from '../i18n.js';
import { h, icon, sheet, toast, fmtDate, confirmDialog, clear } from '../util.js';
import * as cloud from '../cloud.js';
import * as ch from '../challenges.js';
import * as social from '../social.js';
import { today } from '../store.js';
import { refreshChallenges, challengeList } from '../challenge-sync.js';
import { initialAvatar } from './friends.js';
import { googleButton } from './account.js';

const daysText = (n) => tr('{0, plural, one {# day} other {# days}}', n);
const nameOf = (p) => (p ? p.display_name || p.username : '');

const ERRORS = {
  already_challenged: () => tr('You already have a challenge with this friend.'),
  too_many: () => tr('You can have up to {0} challenges at once.', ch.MAX_OPEN),
  not_friends: () => tr('You can only challenge friends.'),
  no_profile: () => tr('Both of you need a username first.'),
  not_set_up: () => tr('Challenges are not switched on at the server yet. Please try again later.'),
  bad_date: () => tr('The date on this phone is off. Fix it and try again.'),
};
export const challengeError = (e) => (e && ERRORS[e.code] ? ERRORS[e.code]() : tr('Couldn\'t reach the server. Try again.'));

const rules = () => h('ul', { class: 'challenge-rules small muted' },
  h('li', null, tr('Mark each meal as eaten before the day ends. A meal you didn\'t mark is a miss.')),
  h('li', null, tr('Whoever goes over the misses allowed loses right away.')),
  h('li', null, tr('If nobody does, whoever missed more when the period ends loses.')));

// ---------- starting one ----------

// user: the friend's profile row ({ user_id, username, display_name }).
export function openChallengeSheet(user, { onDone } = {}) {
  const name = nameOf(user);
  return sheet(tr('Challenge a friend'), (close) => {
    let days = ch.DEFAULTS.days;
    let max = ch.DEFAULTS.maxMisses;
    const chips = h('div', { class: 'scan-modes', role: 'radiogroup', 'aria-label': tr('How long?') });
    const value = h('b', { class: 'num challenge-max', id: 'challenge-max' });
    const msg = h('p', { class: 'small', id: 'challenge-msg', 'aria-live': 'polite' });
    const draw = () => {
      clear(chips);
      for (const n of ch.PRESET_DAYS) {
        chips.appendChild(h('button', { type: 'button', role: 'radio', 'aria-checked': n === days ? 'true' : 'false', 'data-days': n, class: 'custom-mode-btn' + (n === days ? ' on' : ''), onclick: () => { days = n; draw(); } }, daysText(n)));
      }
      value.textContent = String(max);
    };
    draw();
    const send = h('button', { type: 'button', class: 'btn btn-primary btn-block', id: 'challenge-send' }, icon('send', 16), tr('Send challenge'));
    send.addEventListener('click', async () => {
      send.disabled = true;
      msg.className = 'small muted';
      msg.textContent = tr('Sending…');
      try {
        await ch.create(user.user_id, days, max);
        await refreshChallenges({ force: true });
        close();
        toast(tr('Challenge sent'));
        if (onDone) onDone();
      } catch (e) {
        send.disabled = false;
        msg.className = 'small notice warn';
        msg.textContent = challengeError(e);
      }
    });
    return h('div', { class: 'form', id: 'challenge-sheet' },
      h('p', null, h('strong', null, tr('Opponent: {0}', name))),
      rules(),
      h('h4', { class: 'extra-group' }, tr('How long?')),
      chips,
      h('h4', { class: 'extra-group' }, tr('Misses allowed')),
      h('div', { class: 'stepper' },
        h('button', { type: 'button', class: 'icon-btn', id: 'challenge-less', 'aria-label': tr('Less'), onclick: () => { max = Math.max(0, max - 1); draw(); } }, icon('minus', 18)),
        value,
        h('button', { type: 'button', class: 'icon-btn', id: 'challenge-more', 'aria-label': tr('More'), onclick: () => { max = Math.min(ch.MAX_MISSES, max + 1); draw(); } }, icon('plus', 18))),
      msg,
      send);
  });
}

// ---------- one challenge ----------

const idFromHash = () => ((/^#\/challenge\/([0-9a-f-]{36})\/?$/i.exec(location.hash) || [])[1] || '').toLowerCase();

function cell(row, closed) {
  if (!row) return closed ? h('span', { class: 'cell miss' }, icon('close', 14), '—') : h('span', { class: 'cell muted' }, '—');
  const ok = row.logged >= row.planned;
  return h('span', { class: 'cell num ' + (closed ? (ok ? 'ok' : 'miss') : 'now') }, closed ? icon(ok ? 'check' : 'close', 14) : null, `${row.logged}/${row.planned}`);
}

function scoreboard(v, name) {
  const box = (label, n, cls) => h('div', { class: `score ${cls}` },
    h('span', { class: 'score-name' }, label),
    h('strong', { class: 'score-num num' }, String(n)),
    h('span', { class: 'muted small' }, tr('Misses (limit {0})', v.maxMisses)));
  return h('div', { class: 'scoreboard', id: 'scoreboard' },
    box(tr('You'), v.mine.missed, v.mine.missed > v.maxMisses ? 'over' : ''),
    box(name, v.theirs.missed, v.theirs.missed > v.maxMisses ? 'over' : ''));
}

function dayTable(v, name) {
  if (!v.perDay.length) return null;
  const rows = [...v.perDay].reverse().map((d) => h('li', { class: 'day-row' + (d.today ? ' today' : '') },
    h('span', { class: 'day-date' }, fmtDate(d.day, true), d.today ? h('small', { class: 'muted' }, ` · ${tr('Today')}`) : null),
    cell(d.mine, d.closed),
    cell(d.theirs, d.closed)));
  return h('div', { class: 'day-table' },
    h('div', { class: 'day-row head small muted' }, h('span', null, ''), h('span', null, tr('You')), h('span', null, name)),
    h('ul', { class: 'day-list', id: 'day-list' }, ...rows));
}

export async function renderChallenge(root) {
  clear(root);
  const back = h('a', { class: 'btn btn-ghost btn-small', href: '#/profile', 'aria-label': tr('Back‖navigation') }, icon('back', 18));
  const card = h('section', { class: 'card challenge-page', id: 'challenge-page' });
  root.append(h('header', { class: 'page-head' }, back, h('div', { class: 'grow' })), card);
  const id = idFromHash();
  if (!id) { card.appendChild(h('p', { class: 'empty' }, tr('That challenge could not be found.'))); return; }
  if (!cloud.cloudReady() || !cloud.signedIn()) {
    card.append(h('p', null, tr('Sign in to see this challenge.')), googleButton(tr('Sign in with Google'), { id: 'btn-google-challenge', primary: true }));
    return;
  }
  card.appendChild(h('p', { class: 'muted' }, tr('Loading…')));
  let list = challengeList();
  if (!list.some((c) => c.id === id)) list = await refreshChallenges({ force: true });
  if (!document.body.contains(card)) return;
  const v = list.find((c) => c.id === id);
  clear(card);
  if (!v || !v.other) { card.appendChild(h('p', { class: 'empty', id: 'challenge-missing' }, tr('That challenge could not be found.'))); return; }
  drawChallenge(card, v);
  const again = () => { if (document.body.contains(card) && idFromHash() === id) { const next = challengeList().find((c) => c.id === id); if (next) { clear(card); drawChallenge(card, next); } } };
  window.addEventListener('app:challenges', again, { once: true });
}

function drawChallenge(card, v) {
  const name = nameOf(v.other);
  const act = (fn, okText) => async () => {
    try { await fn(); await refreshChallenges({ force: true }); if (okText) toast(okText); const next = challengeList().find((c) => c.id === v.id); clear(card); if (next) drawChallenge(card, next); } catch (e) { toast(challengeError(e)); }
  };
  const badgeText = v.status === 'pending' ? tr('Waiting for an answer')
    : v.status === 'active' ? (v.started ? tr('In progress') : tr('Starts tomorrow'))
      : v.status === 'finished' ? tr('Finished') : v.status === 'declined' ? tr('Declined') : tr('Cancelled');
  card.append(
    h('div', { class: 'user-head' },
      initialAvatar(name, 64),
      h('h1', { id: 'challenge-title' }, tr('Challenge with {0}', name)),
      h('span', { class: `badge ${v.status === 'active' ? 'active' : ''}`, id: 'challenge-status' }, badgeText)),
    h('p', { class: 'muted small center', id: 'challenge-rules-line' }, tr('Period: {0} · Misses allowed: {1}', daysText(v.days), v.maxMisses)));

  if (v.status === 'pending') {
    if (v.iAmCreator) {
      card.append(h('p', { class: 'center', id: 'challenge-waiting' }, tr('Waiting for {0} to answer.', name)), rules(),
        h('button', { type: 'button', class: 'btn btn-block btn-ghost', id: 'challenge-cancel', onclick: act(() => ch.cancel(v.id), tr('Challenge cancelled')) }, tr('Cancel challenge')));
    } else {
      card.append(h('p', { class: 'center', id: 'challenge-invite' }, tr('{0} challenged you.', name)), rules(), h('p', { class: 'small muted center' }, tr('It starts tomorrow.')),
        h('div', { class: 'grid2' },
          h('button', { type: 'button', class: 'btn btn-primary', id: 'challenge-accept', onclick: act(() => ch.respond(v.id, true, today()), tr('Challenge accepted')) }, tr('Accept')),
          h('button', { type: 'button', class: 'btn', id: 'challenge-decline', onclick: act(() => ch.respond(v.id, false, today()), tr('Challenge declined')) }, tr('Decline'))));
    }
    return;
  }
  if (v.status === 'declined' || v.status === 'cancelled') return;

  if (v.status === 'finished') {
    const text = v.draw ? tr('It was a draw.') : v.iWon ? tr('You won! 🎉') : tr('You lost this challenge.');
    card.appendChild(h('p', { class: 'challenge-result ' + (v.iWon ? 'won' : v.iLost ? 'lost' : ''), id: 'challenge-result' }, text));
  } else {
    const left = tr('{0, plural, one {# day left} other {# days left}}', v.daysLeft);
    card.appendChild(h('p', { class: 'center lead', id: 'challenge-progress' }, v.started ? `${tr('Day {0} of {1}', v.dayNumber, v.days)} · ${left}` : (v.startsInDays <= 1 ? tr('Starts tomorrow') : tr('{0, plural, one {Starts in # day} other {Starts in # days}}', v.startsInDays))));
  }
  card.append(scoreboard(v, name));
  const table = dayTable(v, name);
  if (table) card.appendChild(table);
  if (v.status === 'active') {
    card.appendChild(rules());
    card.appendChild(h('button', {
      type: 'button', class: 'btn btn-block btn-ghost danger-text', id: 'challenge-forfeit',
      onclick: async () => {
        if (!(await confirmDialog(tr('Give up this challenge?'), tr('It counts as a loss.'), tr('Give up'), true))) return;
        await act(() => ch.forfeit(v.id), tr('You gave up the challenge'))();
      },
    }, tr('Give up')));
  }
}

// ---------- Profile: record and list ----------

export function challengesCard() {
  if (!cloud.cloudReady() || !cloud.signedIn()) return null;
  const body = h('div', { id: 'challenges-body' }, h('p', { class: 'muted small' }, tr('Loading…')));
  const card = h('section', { class: 'card', id: 'challenges-card' }, h('h2', null, tr('Challenges')), body);
  const draw = async () => {
    let me = null;
    try { me = await social.myProfile(); } catch { /* the record just stays out */ }
    const list = challengeList();
    clear(body);
    const rate = social.winRate(me);
    body.appendChild(rate === null
      ? h('p', { class: 'muted small', id: 'my-record' }, tr('No challenges yet'))
      : h('p', { class: 'num', id: 'my-record' }, h('strong', null, tr('{0}% wins', rate)), h('span', { class: 'muted small' }, ` · ${tr('{0, plural, one {# win} other {# wins}} · {1, plural, one {# loss} other {# losses}}', me.wins, me.losses)}`)));
    if (!list.length) { body.appendChild(h('p', { class: 'muted small' }, tr('Challenge a friend from their profile.'))); return; }
    body.appendChild(h('ul', { class: 'friend-list', id: 'challenge-list' }, ...list.slice(0, 8).filter((c) => c.other).map((c) => challengeRow(c))));
  };
  draw();
  refreshChallenges().then(draw);
  // Redraw when the list changes; stop listening once the card is gone from the page.
  const again = () => { if (!card.isConnected) { window.removeEventListener('app:challenges', again); return; } draw(); };
  window.addEventListener('app:challenges', again);
  return card;
}

function statusLine(c) {
  if (c.status === 'pending') return c.iAmCreator ? tr('Waiting for an answer') : tr('Challenged you');
  if (c.status === 'active') return c.started ? tr('Day {0} of {1}', c.dayNumber, c.days) : tr('Starts tomorrow');
  if (c.status === 'finished') return c.draw ? tr('Draw') : c.iWon ? tr('Won') : tr('Lost');
  return c.status === 'declined' ? tr('Declined') : tr('Cancelled');
}

function challengeRow(c) {
  const name = nameOf(c.other);
  return h('li', { class: 'friend', 'data-status': c.status },
    h('a', { class: 'friend-main', href: `#/challenge/${c.id}` },
      initialAvatar(name, 40),
      h('span', { class: 'friend-text' }, h('b', null, name), h('small', { class: 'muted' }, statusLine(c)))));
}

// ---------- Today: running challenges ----------

export function challengeStrip() {
  const box = h('div', { id: 'challenge-strip' });
  const draw = () => {
    clear(box);
    const list = challengeList().filter((c) => c.other);
    for (const c of ch.invitations(list).slice(0, 2)) {
      const name = nameOf(c.other);
      box.appendChild(h('a', { class: 'card invite-card strip', href: `#/challenge/${c.id}` },
        h('div', { class: 'invite-text' }, h('h3', null, tr('{0} challenged you.', name)), h('p', { class: 'muted small' }, tr('Period: {0} · Misses allowed: {1}', daysText(c.days), c.maxMisses))),
        h('span', { class: 'btn btn-primary' }, tr('View'))));
    }
    for (const c of ch.running(list).slice(0, 2)) {
      const name = nameOf(c.other);
      box.appendChild(h('a', { class: 'card strip', href: `#/challenge/${c.id}`, 'data-challenge': c.id },
        h('div', { class: 'row space' },
          h('h3', null, tr('Challenge with {0}', name)),
          h('span', { class: 'muted small' }, c.started ? tr('Day {0} of {1}', c.dayNumber, c.days) : tr('Starts tomorrow'))),
        h('p', { class: 'num strip-score' }, `${tr('You')} ${c.mine.missed} · ${name} ${c.theirs.missed}`, h('span', { class: 'muted small' }, ` · ${tr('Misses (limit {0})', c.maxMisses)}`))));
    }
  };
  draw();
  const redraw = () => { if (!box.isConnected) { window.removeEventListener('app:challenges', redraw); return; } draw(); };
  window.addEventListener('app:challenges', redraw);
  if (cloud.cloudReady() && cloud.signedIn()) refreshChallenges().then(redraw);
  return box;
}

// ---------- Inbox: invitations ----------

// Appends the challenge invitations to the requests folder; returns how many.
export function challengeInvitations(body, rerender) {
  const list = ch.invitations(challengeList().filter((c) => c.other));
  if (!list.length) return 0;
  const act = async (fn, okText) => {
    try { await fn(); await refreshChallenges({ force: true }); if (okText) toast(okText); rerender(); } catch (e) { toast(challengeError(e)); }
  };
  body.append(h('h3', { class: 'extra-group' }, tr('Challenge invitations')),
    h('ul', { class: 'friend-list', id: 'challenge-invites' }, ...list.map((c) => {
      const name = nameOf(c.other);
      return h('li', { class: 'friend' },
        h('a', { class: 'friend-main', href: `#/challenge/${c.id}` },
          initialAvatar(name, 40),
          h('span', { class: 'friend-text' }, h('b', null, name), h('small', { class: 'muted' }, tr('Period: {0} · Misses allowed: {1}', daysText(c.days), c.maxMisses)))),
        h('div', { class: 'friend-actions' },
          h('button', { type: 'button', class: 'btn btn-small btn-primary', 'data-act': 'accept-challenge', onclick: () => act(() => ch.respond(c.id, true, today()), tr('Challenge accepted')) }, tr('Accept')),
          h('button', { type: 'button', class: 'btn btn-small', 'data-act': 'decline-challenge', onclick: () => act(() => ch.respond(c.id, false, today()), tr('Challenge declined')) }, tr('Decline'))));
    })));
  return list.length;
}

