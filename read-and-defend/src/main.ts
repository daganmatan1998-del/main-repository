import './styles.css';
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
  app.show(app.profile.lang ? 'home' : 'language');
  // Hooks for automated browser tests only; they expose no secrets.
  (window as unknown as { __rd: unknown }).__rd = { app };
}

try {
  boot();
  registerServiceWorker();
} catch (e) {
  console.error(e);
  const layer = document.getElementById('layer');
  if (layer) layer.innerHTML = `<div class="screen solid"><div class="center-col panel"><h2>${t('error')}</h2></div></div>`;
}
