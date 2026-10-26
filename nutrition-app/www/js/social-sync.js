// Keeps the bell's badge honest: how many friend requests wait for an answer,
// and a message in the inbox when someone accepts one we sent. Runs when the
// app starts, comes back to the front, and every few minutes while it is open.

import * as cloud from './cloud.js';
import { loadRelations, forgetRelations } from './screens/friends.js';
import { setWaitingRequests, addMessage } from './inbox.js';

const FRESH_MS = 14 * 24 * 3600 * 1000;
let timer = 0;
let busy = false;

export async function refreshSocial() {
  if (busy) return;
  if (!cloud.cloudReady() || !cloud.signedIn()) { setWaitingRequests(0); return; }
  busy = true;
  try {
    forgetRelations();
    const rel = await loadRelations(true);
    setWaitingRequests(rel.incoming.length);
    for (const f of rel.friends) {
      if (!f.mine || Date.now() - Date.parse(f.at) > FRESH_MS) continue;
      await addMessage('friend-accepted', { id: `friend-accepted-${f.id}`, args: [f.user.display_name || f.user.username], link: `#/u/${f.user.username}` });
    }
  } catch { /* offline or the server is down: the badge keeps its last number */ } finally { busy = false; }
}

export function startSocial() {
  refreshSocial();
  clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden) refreshSocial(); }, 3 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshSocial(); });
}
