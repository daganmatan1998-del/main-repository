// Friends: the card in Profile (username, invite link, search, friend list) and
// the public profile page #/u/<username> that invite links open.

import { t as tr } from '../i18n.js';
import { h, icon, toast, clear, confirmDialog, fmt, sheet } from '../util.js';
import * as cloud from '../cloud.js';
import * as social from '../social.js';
import { state } from '../store.js';
import { googleButton } from './account.js';
import * as ch from '../challenges.js';
import { openChallengeSheet } from './challenges.js';
import { refreshChallenges, challengeList } from '../challenge-sync.js';

const myName = () => (state.profile && (state.profile.nickname || state.profile.name)) || '';

// A round avatar with the person's first letter (other people's photos are not shared).
export function initialAvatar(name, size = 44) {
  const letter = [...String(name || '?').trim()][0] || '?';
  return h('span', { class: 'avatar initial', style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.42)}px` }, 'aria-hidden': 'true' }, letter.toUpperCase());
}

const ERR = () => tr('Couldn\'t reach the server. Try again.');
export const failed = (e) => (e && e.code === 'offline' ? tr('No connection — syncing will continue when you are back online.')
  : e && e.code === 'signed_out' ? tr('Your sign-in expired. Sign in again.')
    : e && e.code === 'not_set_up' ? tr('Friends are not switched on at the server yet. Please try again later.') : ERR());

// The relations are fetched once and shared by the screens until something changes.
let cache = null;
export async function loadRelations(force = false) {
  if (!cache || force) cache = await social.relations();
  return cache;
}
export const forgetRelations = () => { cache = null; };

function shareButtons(username) {
  const link = social.linkFor(username);
  return h('div', { class: 'grid2 share-row' },
    h('a', {
      class: 'btn btn-primary', id: 'share-whatsapp', href: social.whatsappUrl(tr('Add me as a friend on Nutri:'), link), target: '_blank', rel: 'noopener',
    }, icon('send', 16), tr('Send on WhatsApp')),
    h('button', {
      type: 'button', class: 'btn', id: 'share-copy',
      onclick: async () => {
        try { await navigator.clipboard.writeText(link); toast(tr('The link was copied')); } catch { toast(link); }
      },
    }, icon('copy', 16), tr('Copy link')));
}

// ---------- the card in Profile ----------

export function friendsCard() {
  if (!cloud.cloudReady()) return null;
  const body = h('div', { class: 'friends-body' }, h('p', { class: 'muted small' }, tr('Loading…')));
  const card = h('section', { class: 'card', id: 'friends-card' },
    h('div', { class: 'row space' },
      h('h2', null, tr('Friends')),
      h('button', { type: 'button', class: 'btn btn-small btn-primary', id: 'btn-invite-card', onclick: openInviteSheet }, icon('send', 16), tr('Invite friends'))),
    body);
  drawInvite(body);
  return card;
}

// The invite sheet: the same content as the Friends card, from anywhere in the app.
export function openInviteSheet() {
  return sheet(tr('Invite friends'), () => {
    const body = h('div', { class: 'friends-body', id: 'invite-sheet' }, h('p', { class: 'muted small' }, tr('Loading…')));
    drawInvite(body);
    return body;
  });
}

const closeInviteSheet = () => document.querySelectorAll('#invite-sheet').forEach((el) => el.closest('.sheet-backdrop')?.remove());
const rememberName = (name) => { try { localStorage.setItem('nutri-username', name); } catch { /* storage unavailable */ } };
const savedName = () => { try { return localStorage.getItem('nutri-username') || ''; } catch { return ''; } };

// Whatever state the person is in, this says what to do next: sign in, choose a
// username, or invite — and a failed request can be retried.
async function drawInvite(body) {
  clear(body);
  if (!cloud.cloudReady()) { body.appendChild(h('p', { class: 'muted small' }, tr('Sign-in isn\'t available yet — it\'s coming in the next update.'))); return; }
  if (!cloud.signedIn()) {
    body.append(
      h('p', { class: 'muted small' }, tr('Sign in to add friends and challenge them.')),
      googleButton(tr('Sign in with Google'), { id: 'btn-google-friends', primary: true }));
    return;
  }
  body.appendChild(h('p', { class: 'muted small' }, tr('Loading…')));
  let me;
  let rel;
  try { me = await social.myProfile(); rel = me ? await loadRelations(true) : null; } catch (e) {
    clear(body);
    body.append(h('p', { class: 'notice warn small', id: 'friends-error' }, failed(e)),
      h('button', { type: 'button', class: 'btn btn-block', id: 'friends-retry', onclick: () => drawInvite(body) }, tr('Try again')));
    // The invite link needs no server: with a username already chosen, it still works.
    if (savedName()) body.append(h('h3', { class: 'extra-group' }, tr('Invite a friend')), shareButtons(savedName()));
    return;
  }
  clear(body);
  if (!me) { body.appendChild(usernameForm(() => drawInvite(body))); return; }
  rememberName(me.username);
  drawInviteContent(body, me, rel);
}

function drawInviteContent(body, me, rel) {
  const find = h('input', { class: 'search', id: 'friend-search', type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: tr('Friend\'s username'), 'aria-label': tr('Friend\'s username') });
  const go = () => {
    const name = social.normalizeUsername(find.value);
    if (!social.validUsername(name)) { toast(tr('Use 3–20 letters (a–z), digits or an underscore.')); find.focus(); return; }
    closeInviteSheet();
    location.hash = `#/u/${name}`;
  };
  find.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });

  body.append(
    h('div', { class: 'row space' },
      h('div', null, h('div', { class: 'muted small' }, tr('Your username')), h('strong', { id: 'my-username', dir: 'ltr' }, `@${me.username}`)),
      h('a', { class: 'btn btn-small', href: `#/u/${me.username}`, onclick: closeInviteSheet }, tr('My profile'))),
    h('h3', { class: 'extra-group' }, tr('Invite a friend')),
    shareButtons(me.username),
    h('h3', { class: 'extra-group' }, tr('Add a friend by username')),
    h('div', { class: 'scan-manual' }, find, h('button', { type: 'button', class: 'btn btn-primary', id: 'friend-find', onclick: go }, tr('Find'))),
    h('h3', { class: 'extra-group' }, tr('My friends ({0})', fmt(rel.friends.length))),
    rel.friends.length
      ? h('ul', { class: 'friend-list', id: 'friend-list' }, ...rel.friends.map((f) => personRow(f.user)))
      : h('p', { class: 'muted small' }, tr('No friends yet. Share your link or search for a username.')));
}

export function personRow(u, ...actions) {
  return h('li', { class: 'friend' },
    h('a', { class: 'friend-main', href: `#/u/${u.username}`, onclick: closeInviteSheet },
      initialAvatar(u.display_name || u.username, 40),
      h('span', { class: 'friend-text' }, h('b', null, u.display_name || u.username), h('small', { class: 'muted', dir: 'ltr' }, `@${u.username}`))),
    ...actions);
}

function usernameForm(done) {
  const input = h('input', { class: 'search', id: 'username-input', type: 'text', maxlength: 20, autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: 'username', dir: 'ltr', 'aria-label': tr('Username') });
  const msg = h('p', { class: 'small', id: 'username-msg', 'aria-live': 'polite' });
  // What will be saved, as soon as it differs from what was typed (spaces and hyphens become _).
  const preview = h('p', { class: 'muted small', id: 'username-preview', dir: 'ltr' });
  input.addEventListener('input', () => {
    const name = social.normalizeUsername(input.value);
    preview.textContent = name && name !== input.value.trim() && social.validUsername(name) ? tr('It will be saved as @{0}', name) : '';
  });
  const save = async () => {
    const name = social.normalizeUsername(input.value);
    if (!social.validUsername(name)) { msg.className = 'small notice warn'; msg.textContent = tr('Use 3–20 letters (a–z), digits or an underscore.'); return; }
    msg.className = 'small muted'; msg.textContent = tr('Saving…');
    try {
      const r = await social.saveMyProfile({ username: name, displayName: myName() });
      if (r === 'taken') { msg.className = 'small notice warn'; msg.textContent = tr('This username is taken. Try another.'); return; }
      if (r === 'invalid') { msg.className = 'small notice warn'; msg.textContent = tr('Use 3–20 letters (a–z), digits or an underscore.'); return; }
      toast(tr('Your username is @{0}', name));
      done();
    } catch (e) { msg.className = 'small notice warn'; msg.textContent = failed(e); }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  return h('div', { class: 'form', id: 'username-form' },
    h('p', null, h('strong', null, tr('Choose a username'))),
    h('p', { class: 'muted small' }, tr('Friends find you by this username. Use 3–20 letters (a–z), digits or an underscore.')),
    input, preview, msg,
    h('button', { type: 'button', class: 'btn btn-primary btn-block', id: 'username-save', onclick: save }, tr('Save username')));
}

// ---------- the public profile page ----------

export async function renderUserProfile(root) {
  const username = social.usernameFromHash(location.hash);
  clear(root);
  const back = h('a', { class: 'btn btn-ghost btn-small', href: '#/profile', 'aria-label': tr('Back‖navigation') }, icon('back', 18));
  const card = h('section', { class: 'card user-profile', id: 'user-profile' });
  root.append(h('header', { class: 'page-head' }, back, h('div', { class: 'grow' })), card);

  if (!username) { card.appendChild(h('p', { class: 'empty' }, tr('That link is not a valid profile link.'))); return; }
  if (!cloud.cloudReady() || !cloud.signedIn()) {
    card.append(
      h('p', null, tr('Sign in to see this profile and send a friend request.')),
      googleButton(tr('Sign in with Google'), { id: 'btn-google-profile', primary: true }));
    return;
  }
  card.appendChild(h('p', { class: 'muted' }, tr('Loading…')));

  let user;
  let rel;
  try { user = await social.findByUsername(username); rel = await loadRelations(true); await refreshChallenges(); } catch (e) { clear(card); card.appendChild(h('p', { class: 'notice warn' }, failed(e))); return; }
  if (!document.body.contains(card)) return; // navigated away meanwhile
  clear(card);
  if (!user) { card.appendChild(h('p', { class: 'empty', id: 'user-missing' }, tr('There is no user named @{0}.', username))); return; }

  const name = user.display_name || user.username;
  const rate = social.winRate(user);
  card.append(
    h('div', { class: 'user-head' },
      initialAvatar(name, 72),
      h('h1', { id: 'user-name' }, name),
      h('p', { class: 'muted', dir: 'ltr', id: 'user-handle' }, `@${user.username}`)),
    h('div', { class: 'user-stats', id: 'user-stats' },
      rate === null
        ? h('p', { class: 'muted' }, tr('No challenges yet'))
        : [h('strong', { class: 'num' }, tr('{0}% wins', rate)),
          h('span', { class: 'muted small num' }, tr('{0, plural, one {# win} other {# wins}} · {1, plural, one {# loss} other {# losses}}', user.wins, user.losses))]),
    h('div', { class: 'user-actions', id: 'user-actions' }));
  drawActions(card.querySelector('#user-actions'), user, rel);
}

function drawActions(box, user, rel) {
  clear(box);
  const name = user.display_name || user.username;
  const rerun = async () => { forgetRelations(); const next = await loadRelations(true); drawActions(box, user, next); };
  const run = (fn, okText) => async () => {
    try { await fn(); if (okText) toast(okText); await rerun(); } catch (e) { toast(failed(e)); }
  };
  const r = social.relationTo(user.user_id, rel);
  const btn = (label, onclick, cls = 'btn', id = '') => h('button', { type: 'button', class: `btn-block ${cls}`, id, onclick }, label);
  if (r.kind === 'self') {
    box.append(h('p', { class: 'muted small' }, tr('This is your profile. Share your link so friends can find you.')), shareButtons(user.username));
  } else if (r.kind === 'none') {
    box.appendChild(btn(tr('Send friend request'), run(() => social.sendRequest(user.user_id, rel), tr('Friend request sent')), 'btn btn-primary', 'friend-add'));
  } else if (r.kind === 'sent') {
    box.append(h('p', { class: 'muted small', id: 'friend-sent' }, tr('Request sent. Waiting for {0}.', name)),
      btn(tr('Cancel request'), run(() => social.removeRequest(r.request.id), tr('Request cancelled')), 'btn btn-ghost', 'friend-cancel'));
  } else if (r.kind === 'received') {
    box.append(h('p', { id: 'friend-received' }, tr('{0} sent you a friend request.', name)),
      h('div', { class: 'grid2' },
        btn(tr('Accept'), run(() => social.respond(r.request.id, 'accepted'), tr('You are now friends with {0}', name)), 'btn btn-primary', 'friend-accept'),
        btn(tr('Decline'), run(() => social.respond(r.request.id, 'declined'), tr('Request declined')), 'btn', 'friend-decline')));
  } else {
    const open = ch.withFriend(challengeList(), user.user_id);
    box.append(h('p', { class: 'badge active', id: 'friend-badge' }, icon('check', 14), ' ', tr('Friends')),
      open
        ? h('a', { class: 'btn btn-block btn-primary', id: 'friend-challenge-open', href: `#/challenge/${open.id}` }, tr('View the challenge'))
        : btn(tr('Challenge to a competition'), () => openChallengeSheet(user, { onDone: () => drawActions(box, user, rel) }), 'btn btn-primary', 'friend-challenge'),
      btn(tr('Remove friend'), async () => {
        if (!(await confirmDialog(tr('Remove {0} from your friends?', name), tr('You can add them again later.'), tr('Remove friend'), true))) return;
        await run(() => social.removeRequest(r.request.id), tr('Friend removed'))();
      }, 'btn btn-ghost danger-text', 'friend-remove'));
  }
}
