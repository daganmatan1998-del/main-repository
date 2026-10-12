// Language picker: a small button showing the current language, which opens a
// list of every language in its own name. Used on the first screen, the
// welcome screen and in Profile. Choosing a language saves it and reloads the
// app (i18n.js), so every text, date and number follows.

import { t as tr, LANGS, lang, setLanguage } from '../i18n.js';
import { h, icon, sheet } from '../util.js';
import { saveSettings } from '../store.js';

const current = () => LANGS.find((l) => l.code === lang);

function openPicker() {
  sheet(tr('Language‖picker title'), (close) => h('div', { class: 'lang-list', id: 'lang-list', role: 'radiogroup', 'aria-label': tr('Language‖picker title') },
    ...LANGS.map((l) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(l.code === lang), lang: l.code, dir: l.dir,
      class: `lang-item${l.code === lang ? ' active' : ''}`, 'data-lang': l.code,
      onclick: async () => {
        if (l.code === lang) { close(); return; }
        try { await saveSettings({ lang: l.code }); } catch { /* the choice is also kept in localStorage */ }
        setLanguage(l.code);
      },
    }, h('span', null, l.name), l.code === lang ? icon('check', 18) : null))));
}

export function languageButton() {
  return h('button', { type: 'button', class: 'btn btn-ghost btn-small lang-btn', id: 'lang-btn', onclick: openPicker, 'aria-haspopup': 'dialog' },
    icon('globe', 16), h('span', { lang }, current().name));
}

// A row to put at the top of a screen.
export const languageBar = () => h('div', { class: 'lang-bar' }, languageButton());
