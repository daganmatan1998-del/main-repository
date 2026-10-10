import './styles.css';
import { initInstall } from './platform/install';
import { applyUpdate, onUpdateAvailable, startUpdateChecks, updateAvailable } from './platform/update';
import { el, icon } from './ui/dom';
import { registerServiceWorker } from './platform/platform';
import { App } from './ui/app';
import { GameSession } from './ui/gameSession';
import { homeScreen, languageScreen, mapScreen, progressScreen, settingsScreen, shopScreen } from './ui/screens';
import { t } from './i18n/strings';

function boot(): void {
  const app = new App();
  app.screens = {
    language: languageScreen,
    home: homeScreen,
    map: mapScreen,
    shop: shopScreen,
    progress: progressScreen,
    settings: settingsScreen,
  };
  app.startLevel = (level, opts) => {
    new GameSession(app, level, opts).start().catch((e) => {
      console.error(e);
      app.sessionActive = false;
      app.show('home');
    });
  };
  // "New version - Update": shown on the menus, never in the middle of a level.
  const updateBar = () => {
    document.getElementById('updateBar')?.remove();
    if (!updateAvailable() || app.sessionActive) return;
    const btn = el('button', { class: 'btn btn-gold', 'data-testid': 'update' }, icon('download'), t('updateNow'));
    btn.addEventListener('click', () => { btn.setAttribute('disabled', ''); void applyUpdate(); });
    app.layer.append(el('div', { id: 'updateBar', class: 'update-bar', role: 'status' }, el('span', {}, t('updateReady')), btn));
  };
  app.afterShow = updateBar;
  onUpdateAvailable(updateBar);
  app.show(app.profile.lang ? 'home' : 'language');
  // Hooks for automated browser tests only; they expose no secrets.
  (window as unknown as { __rd: unknown }).__rd = { app };
}

/**
 * Inside the Android/iOS app the WebView has no Web Speech API, so voice goes
 * through the native plugin. It is imported only there — the web build never
 * downloads it (Vite splits it into its own chunk).
 */
async function prepareNative(): Promise<void> {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return;
  try {
    const m = await import('@capacitor-community/speech-recognition');
    (window as unknown as { __nativeSpeech: unknown }).__nativeSpeech = m.SpeechRecognition;
  } catch (e) {
    console.error('native speech plugin unavailable', e);
  }
}

async function start(): Promise<void> {
  initInstall(); // catches the browser's install offer before the home screen asks for it
  await prepareNative();
  boot();
  registerServiceWorker();
  startUpdateChecks();
}

start().catch((e) => {
  console.error(e);
  const layer = document.getElementById('layer');
  if (layer) layer.innerHTML = `<div class="screen solid"><div class="center-col panel"><h2>${t('error')}</h2></div></div>`;
});
