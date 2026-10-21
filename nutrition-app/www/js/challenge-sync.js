// Keeps the challenges up to date: reports this phone's days (meals planned and
// marked as eaten) to the server, asks it to settle a period that has ended, and
// leaves a message in the inbox when a challenge was accepted, declined or decided.

import * as cloud from './cloud.js';
import * as ch from './challenges.js';
import { profilesByIds } from './social.js';
import { state, today, dayPlan, onChange } from './store.js';
import { addMessage, setChallengeInvites } from './inbox.js';

let latest = [];
let busy = false;
let runs = 0; // the newest run is the one that counts when two overlap
let timer = 0;
const FRESH_MS = 14 * 24 * 3600 * 1000;

export const challengeList = () => latest;

// What this phone knows about a day: meals planned, meals marked as eaten.
export function countDay(day) {
  const plan = dayPlan(day);
  if (!plan.length) return null;
  const eaten = (state.logs[day] && state.logs[day].eaten) || [];
  return { planned: plan.length, logged: plan.filter((m) => eaten.includes(m.index)).length };
}

export async function refreshChallenges({ force = false } = {}) {
  if (busy && !force) return latest;
  if (!cloud.cloudReady() || !cloud.signedIn()) { latest = []; setChallengeInvites(0); window.dispatchEvent(new Event('app:challenges')); return latest; }
  busy = true;
  const mine = ++runs;
  try {
    const t = today();
    let list = await ch.list(t, profilesByIds);
    // Report what this phone counts, and let the server settle periods that ended.
    let touched = false;
    for (const v of list.filter((c) => c.status === 'active')) {
      try {
        for (const d of ch.dueReports(v, t, countDay)) { await ch.report(v.id, d.day, d.planned, d.logged, t); touched = true; }
        if (ch.needsSettling(v, t)) { await ch.evaluate(v.id, t); touched = true; }
      } catch (e) { if (e.code === 'not_set_up') throw e; /* one challenge failing must not stop the rest */ }
    }
    if (touched) list = await ch.list(t, profilesByIds);
    if (mine !== runs) return latest; // a newer refresh started meanwhile: its answer wins
    latest = list;
    setChallengeInvites(ch.invitations(list).length);
    await announce(list);
    window.dispatchEvent(new Event('app:challenges'));
  } catch { /* offline or not set up: keep what was shown */ } finally { if (mine === runs) busy = false; }
  return latest;
}

// One inbox message for each thing that happened (the same id is stored once).
async function announce(list) {
  for (const c of list) {
    if (!c.other) continue;
    const name = c.other.display_name || c.other.username;
    const recent = Date.now() - Date.parse(c.updatedAt || c.createdAt) < FRESH_MS;
    if (!recent) continue;
    const link = `#/challenge/${c.id}`;
    if (c.status === 'active' && c.iAmCreator) await addMessage('challenge-accepted', { id: `challenge-${c.id}-active`, args: [name], link });
    if (c.status === 'declined' && c.iAmCreator) await addMessage('challenge-declined', { id: `challenge-${c.id}-declined`, args: [name], link });
    if (c.status === 'finished') {
      const kind = c.draw ? 'challenge-draw' : c.iWon ? 'challenge-won' : 'challenge-lost';
      await addMessage(kind, { id: `challenge-${c.id}-finished`, args: [name], link });
    }
  }
}

export function startChallengeSync() {
  refreshChallenges();
  clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden) refreshChallenges(); }, 3 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshChallenges(); });
  // A meal marked or unmarked: tell the server soon (once, after the taps stop).
  let wait = 0;
  onChange(() => {
    if (!latest.some((c) => c.status === 'active')) return;
    clearTimeout(wait);
    wait = setTimeout(() => refreshChallenges({ force: true }), 3000);
  });
}
