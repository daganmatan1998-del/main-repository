// The inbox: every message the app sends the person, kept on this device
// (messages are stored as a kind and its values, and written in the current
// language when shown). Friend requests are kept apart (screens/inbox.js
// shows them in their own folder); here only their number is tracked, for
// the badge on the bell.

import * as db from './db.js';

const KEY = 'inbox';
const MAX = 100;
let list = [];
let requests = 0; // friend requests waiting for an answer
let invites = 0; // challenges waiting for an answer

const changed = () => window.dispatchEvent(new Event('app:inbox'));

export async function loadInbox() {
  list = (await db.kv.get(KEY).catch(() => null)) || [];
  changed();
}

async function save() {
  list = list.slice(0, MAX);
  try { await db.kv.set(KEY, list); } catch { /* storage full: the list stays in memory */ }
  changed();
}

// kind: what happened; args: the values the text needs; id: the same id is
// stored once (a message the app would otherwise repeat on every start).
export async function addMessage(kind, { id = `${kind}-${Date.now()}`, args = [], link = '' } = {}) {
  if (list.some((m) => m.id === id)) return false;
  list = [{ id, kind, args, link, at: Date.now(), read: false }, ...list];
  await save();
  return true;
}

export const messages = () => list;
export const unreadMessages = () => list.filter((m) => !m.read).length;
export const waitingRequests = () => requests;
export const waitingInvites = () => invites;
// What the bell's badge shows.
export const badgeCount = () => unreadMessages() + requests + invites;

export function setWaitingRequests(n) {
  if (n === requests) return;
  requests = n;
  changed();
}

export function setChallengeInvites(n) {
  if (n === invites) return;
  invites = n;
  changed();
}

export async function markRead(id) {
  const m = list.find((x) => x.id === id);
  if (!m || m.read) return;
  list = list.map((x) => (x.id === id ? { ...x, read: true } : x));
  await save();
}

export async function markAllRead() {
  if (!list.some((m) => !m.read)) return;
  list = list.map((m) => ({ ...m, read: true }));
  await save();
}

export async function removeMessage(id) {
  list = list.filter((m) => m.id !== id);
  await save();
}

export async function clearInbox() {
  list = [];
  await save();
}
