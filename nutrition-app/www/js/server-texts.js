// Fixed sentences the server sends in English (it has no translations of its
// own). The app shows them in the active language; anything else the server
// sends — the assistant's own words, which are already in the user's language —
// passes through untouched.

import { t as tr } from './i18n.js';

const TEXTS = {
  'I can\'t help with that question. You can ask about the menu, substitutions and food.': tr('I can\'t help with that question. You can ask about the menu, substitutions and food.'),
  'These photos can\'t be analyzed. Try other photos or enter a value manually.': tr('These photos can\'t be analyzed. Try other photos or enter a value manually.'),
  'The photos are not suitable for analysis.': tr('The photos are not suitable for analysis.'),
  'This photo can\'t be analyzed. Try taking it again.': tr('This photo can\'t be analyzed. Try taking it again.'),
  'No food was recognized in the photo.': tr('No food was recognized in the photo.'),
  'No food was recognized in the photo. Photograph the whole plate from above.': tr('No food was recognized in the photo. Photograph the whole plate from above.'),
};

export const serverText = (s) => (typeof s === 'string' && Object.hasOwn(TEXTS, s) ? TEXTS[s] : s);
