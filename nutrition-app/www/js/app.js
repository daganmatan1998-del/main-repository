// App shell: boot, routing, and the weekly-photo gate.
//
// The gate is enforced in exactly one place — render() — and render() runs on
// every route change, every return from the background, every focus, and once
// a minute. Whatever the user navigates to, render() checks the gate first and
// shows the check-in instead. Removing the gate from the DOM by hand is
// detected and the gate is re-rendered.

import { h, icon, clear, toast } from './util.js';
import * as store from './store.js';
import { renderOnboarding } from './screens/onboarding.js';
import { renderGate, renderSummary, hasSummary } from './screens/checkin.js';
import { renderToday } from './screens/today.js';
import { renderPlan } from './screens/plan.js';
import { renderAssistant, queueSubstitution, queueAsk } from './screens/assistant.js';
import { renderGallery } from './screens/gallery.js';
import { renderProfile } from './screens/profile.js';
import { renderShopping } from './screens/shopping.js';
import { applyTheme } from './theme.js';
import { onInstallChange } from './install.js';

const ROUTES = {
  today: { label: 'היום', icon: 'today', render: renderToday },
  plan: { label: 'תפריט', icon: 'plan', render: renderPlan },
  assistant: { label: 'עוזר', icon: 'chat', render: renderAssistant },
  gallery: { label: 'גלריה', icon: 'gallery', render: renderGallery },
  profile: { label: 'פרופיל', icon: 'profile', render: renderProfile },
  // Not a tab: opened from the menu screen, which stays highlighted.
  shopping: { render: renderShopping, tab: 'plan' },
};

const view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');
let cleanup = null;
let lastKey = '';
let gateObserver = null;

function route() {
  const name = (location.hash.match(/^#\/(\w+)/) || [])[1];
  return ROUTES[name] ? name : 'today';
}

function buildTabbar(active) {
  clear(tabbar);
  for (const [name, r] of Object.entries(ROUTES)) {
    if (r.tab) continue;
    tabbar.appendChild(h('a', {
      href: `#/${name}`,
      class: 'tab' + (name === active ? ' on' : ''),
      'aria-current': name === active ? 'page' : null,
    }, icon(r.icon, 24), h('span', null, r.label)));
  }
}

function setLocked(locked) {
  document.body.classList.toggle('locked', locked);
  tabbar.hidden = locked;
  tabbar.inert = locked;
  // Overlays marked .keep (the body-fat camera) are part of the current flow.
  if (locked) document.querySelectorAll('.sheet-backdrop, .overlay:not(.keep)').forEach((el) => el.remove());
}

function watchGate() {
  if (gateObserver) gateObserver.disconnect();
  gateObserver = new MutationObserver(() => {
    if (store.gate().state !== 'none' && !document.getElementById('gate')) render(true);
  });
  gateObserver.observe(view, { childList: true, subtree: true });
}

function stopWatchingGate() {
  if (gateObserver) { gateObserver.disconnect(); gateObserver = null; }
}

export function render(force = false) {
  if (!store.state.loaded) return;

  if (!store.isOnboarded()) {
    setLocked(true);
    stopWatchingGate();
    if (force || lastKey !== 'onboarding') {
      lastKey = 'onboarding';
      runCleanup();
      document.body.dataset.screen = 'onboarding';
      renderOnboarding(view);
    }
    return;
  }

  const gate = store.gate();
  if (gate.state !== 'none') {
    // Any navigation while the gate is due lands here.
    const key = `gate:${gate.week}:${gate.state}`;
    setLocked(true);
    if (force || lastKey !== key || !document.getElementById('gate')) {
      lastKey = key;
      runCleanup();
      document.body.dataset.screen = 'gate';
      stopWatchingGate();
      renderGate(view, gate);
      watchGate();
      window.scrollTo(0, 0);
    }
    return;
  }
  stopWatchingGate();

  if (hasSummary()) {
    setLocked(true);
    lastKey = 'summary';
    runCleanup();
    document.body.dataset.screen = 'summary';
    renderSummary(view, () => {
      lastKey = '';
      if (route() !== 'today') location.hash = '#/today';
      else render(true);
    });
    return;
  }

  setLocked(false);
  const name = route();
  lastKey = `route:${name}`;
  runCleanup();
  clear(view);
  document.body.dataset.screen = name;
  buildTabbar(ROUTES[name].tab || name);
  const ctx = {
    askAbout: (item, meal, res) => queueSubstitution(item, meal, res),
  };
  const page = h('div', { class: `page page-${name}` });
  view.appendChild(page);
  try {
    cleanup = ROUTES[name].render(page, ctx) || null;
  } catch (e) {
    console.error(e);
    page.appendChild(h('div', { class: 'card notice warn' }, 'אירעה שגיאה בטעינת המסך. נסו לרענן.'));
  }
  page.classList.add('enter');
}

function runCleanup() {
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;
}

// Re-render preserving scroll (used after data changes on the same screen).
let pending = false;
function rerender() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    const y = window.scrollY;
    const key = lastKey;
    render(true);
    if (key === lastKey && key.startsWith('route:')) window.scrollTo(0, y);
  });
}

function updateOnline() {
  document.body.classList.toggle('offline', !navigator.onLine);
}

async function boot() {
  try {
    await store.load();
  } catch (e) {
    console.error(e);
    clear(view).appendChild(h('div', { class: 'boot-error' },
      h('h1', null, 'לא ניתן לפתוח את האחסון'),
      h('p', null, 'האפליקציה שומרת נתונים במכשיר ודורשת אחסון מקומי. במצב גלישה פרטית חלק מהדפדפנים חוסמים אותו — נסו בחלון רגיל.')));
    return;
  }
  applyTheme(store.state.settings.theme);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(store.state.settings.theme));

  store.onChange(rerender);
  window.addEventListener('app:rerender', rerender);
  window.addEventListener('app:ask', (e) => queueAsk(e.detail.text, e.detail.extra));
  window.addEventListener('hashchange', () => render());
  // Coming back from the background, restoring from bfcache, or regaining focus
  // all re-check the gate: a week may have rolled over while the app was hidden.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') render(); });
  window.addEventListener('pageshow', () => render());
  window.addEventListener('focus', () => render());
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    const g = store.isOnboarded() ? store.gate() : null;
    if (g && g.state !== 'none' && !lastKey.startsWith('gate:')) render(true);
  }, 30000);

  window.addEventListener('online', () => { updateOnline(); toast('חזרת לאינטרנט'); });
  window.addEventListener('offline', () => { updateOnline(); toast('אין חיבור — האפליקציה ממשיכה לעבוד במכשיר'); });
  updateOnline();
  onInstallChange(() => { if (lastKey === 'route:today' || lastKey === 'route:profile') rerender(); });

  document.getElementById('splash')?.remove();
  render(true);
  registerSW();
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate(w);
      });
    });
    if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
  }).catch((e) => console.warn('SW registration failed', e));
  // Reload only when an update replaces a running worker — not when the very
  // first worker takes control, which would throw away a new user's input.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !hadController) return;
    reloaded = true;
    location.reload();
  });
}

function showUpdate(worker) {
  if (document.getElementById('update-bar')) return;
  document.body.appendChild(h('div', { id: 'update-bar', role: 'status' },
    h('span', null, 'גרסה חדשה זמינה'),
    h('button', { class: 'btn btn-small btn-primary', onclick: () => worker.postMessage({ type: 'SKIP_WAITING' }) }, 'עדכון')));
}

boot();
