// Drinks: what the person drank with a meal, as free text. The text is matched
// against a small table of common drinks (per cup of 250 ml unless noted) to
// get calories; anything it doesn't know is saved with 0 calories and the
// person can type the calories per cup themselves. Sugar and the number of
// cups are optional.

import { t as tr, trl } from './i18n.js';
import { normText } from './util.js';

export const SUGAR_TSP_KCAL = 16; // one level teaspoon of sugar: 4 g
export const SUGAR_TSP_CARBS = 4;

// kcal / macros per cup. `keys`: words that identify the drink (the longest
// match in the text wins), so "קפה עם חלב" beats the plain "קפה".
const DRINKS = [
  { name: tr('Water'), keys: [tr('Water'), ...trl('mineral water'), ...trl('soda water'), ...trl('club soda'), ...trl('water with lemon')], kcal: 0, p: 0, c: 0, f: 0 },
  { name: tr('Tea (no sugar)'), keys: [...trl('tea'), ...trl('green tea'), ...trl('mint tea'), ...trl('herbal tea'), ...trl('infusion')], kcal: 2, p: 0, c: 0.5, f: 0 },
  { name: tr('Black coffee'), keys: [tr('Black coffee'), ...trl('espresso'), ...trl('americano'), ...trl('coffee without milk'), ...trl('black nescafe'), ...trl('turkish coffee'), ...trl('instant coffee'), ...trl('coffee')], kcal: 3, p: 0.2, c: 0.4, f: 0 },
  { name: tr('Coffee with a splash of milk'), keys: [...trl('coffee with milk'), tr('Coffee with a splash of milk'), ...trl('nescafe with milk'), ...trl('nescafe'), ...trl('flavored coffee')], kcal: 35, p: 1.8, c: 2.5, f: 1.8 },
  { name: tr('Latte / flat white'), keys: [...trl('hafuch'), ...trl('latte'), ...trl('hafuch coffee'), ...trl('cappuccino'), ...trl('cappuccino'), ...trl('coffee latte'), ...trl('large macchiato')], kcal: 120, p: 6, c: 9, f: 6 },
  { name: tr('Iced coffee'), keys: [tr('Iced coffee'), ...trl('iced coffee'), ...trl('iced latte'), ...trl('coffee with ice')], kcal: 110, p: 4, c: 17, f: 3 },
  { name: tr('Chocolate milk'), keys: [tr('Chocolate milk'), ...trl('hot chocolate'), ...trl('cold chocolate milk'), ...trl('cocoa'), ...trl('tnuva chocolate milk')], kcal: 170, p: 8, c: 24, f: 5 },
  { name: tr('Milk 3%'), keys: [...trl('milk'), tr('Milk 3%'), ...trl('glass of milk')], kcal: 150, p: 8, c: 12, f: 8 },
  { name: tr('Milk 1%'), keys: [tr('Milk 1%'), ...trl('low-fat milk')], kcal: 110, p: 8, c: 12, f: 2.5 },
  { name: tr('Soy milk'), keys: [tr('Soy milk'), ...trl('soy drink')], kcal: 90, p: 7, c: 4, f: 4 },
  { name: tr('Almond milk (unsweetened)'), keys: [...trl('almond milk'), ...trl('almond drink')], kcal: 30, p: 1, c: 1, f: 2.5 },
  { name: tr('Oat milk'), keys: [tr('Oat milk'), ...trl('oat milk'), ...trl('oat drink')], kcal: 120, p: 3, c: 16, f: 5 },
  { name: tr('protein shake'), keys: [...trl('protein shake'), ...trl('shake'), ...trl('protein drink'), ...trl('protein')], kcal: 200, p: 25, c: 10, f: 5 },
  { name: tr('Fruit smoothie'), keys: [...trl('smoothie'), ...trl('smoothie'), ...trl('fruit shake')], kcal: 170, p: 3, c: 38, f: 1 },
  { name: tr('Fresh orange juice'), keys: [...trl('orange juice'), ...trl('squeezed orange juice'), ...trl('orange juice'), ...trl('juice')], kcal: 110, p: 2, c: 26, f: 0.5 },
  { name: tr('Apple / grape juice'), keys: [...trl('apple juice'), ...trl('grape juice'), ...trl('fruit juice'), ...trl('prigat'), ...trl('primor')], kcal: 115, p: 0.3, c: 28, f: 0 },
  { name: tr('Lemonade / sweetened juice'), keys: [...trl('lemonade'), ...trl('sweetened drink'), ...trl('sweetened beverage'), ...trl('lipton'), ...trl('iced tea'), ...trl('cold tea'), ...trl('syrup')], kcal: 90, p: 0, c: 23, f: 0 },
  { name: tr('Cola / sweetened soft drink'), keys: [...trl('cola'), ...trl('coca-cola'), ...trl('pepsi'), ...trl('sprite'), ...trl('fanta'), ...trl('soft drink'), ...trl('sweetened soda'), ...trl('schweppes'), ...trl('fizzy drink')], kcal: 105, p: 0, c: 26, f: 0 },
  { name: tr('Diet / zero drink'), keys: [...trl('zero'), ...trl('diet'), ...trl('cola zero'), ...trl('diet cola'), ...trl('pepsi max'), ...trl('diet drink'), ...trl('diet soda')], kcal: 2, p: 0, c: 0, f: 0 },
  { name: tr('Energy drink'), keys: [tr('Energy drink'), ...trl('red bull'), 'XL', ...trl('monster'), ...trl('energy')], kcal: 110, p: 0, c: 27, f: 0 },
  { name: tr('Isotonic / sports drink'), keys: [...trl('isotonic'), ...trl('gatorade'), ...trl('sports drink'), ...trl('powerade')], kcal: 60, p: 0, c: 15, f: 0 },
  { name: tr('Drinking yogurt'), keys: [...trl('drinking yogurt'), tr('Drinking yogurt'), ...trl('danonino drink'), ...trl('yogurt drink'), ...trl('kefir'), ...trl('bio drink'), ...trl('dairy drink')], kcal: 130, p: 7, c: 18, f: 3 },
  { name: tr('Beer (glass)'), keys: [...trl('beer'), ...trl('goldstar'), ...trl('malka'), ...trl('corona'), ...trl('light beer')], kcal: 110, p: 1, c: 9, f: 0 },
  { name: tr('Wine (small glass)'), keys: [...trl('wine'), ...trl('red wine'), ...trl('white wine'), ...trl('rosé')], kcal: 125, p: 0, c: 4, f: 0 },
  { name: tr('Spirits (shot)'), keys: [...trl('vodka'), ...trl('whisky'), ...trl('arak'), ...trl('gin'), ...trl('gin and tonic'), ...trl('shot'), ...trl('tequila'), ...trl('rum'), ...trl('cocktail'), ...trl('liqueur')], kcal: 100, p: 0, c: 1, f: 0 },
].map((d) => ({ ...d, normKeys: [...new Set(d.keys.map(normText))] }));

// Names offered while typing (the input's suggestions).
export const DRINK_NAMES = DRINKS.map((d) => d.name);

// The table entry the text is about: the longest key contained in the text
// (as whole words), or null.
export function matchDrink(text) {
  const t = ` ${normText(text)} `;
  if (t.trim() === '') return null;
  let best = null;
  let bestLen = 0;
  for (const d of DRINKS) {
    for (const k of d.normKeys) {
      if (k.length > bestLen && t.includes(` ${k} `)) { best = d; bestLen = k.length; }
    }
  }
  // "חלב" alone must not turn "שוקו חלב" into plain milk: longer keys already win.
  return best;
}

const r1 = (n) => Math.round(n * 10) / 10;
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// A drink entry from what the person typed. sugar = teaspoons per cup, count =
// cups. kcalCup is the calories of one cup without sugar: from the table, or
// whatever the person entered for a drink the table doesn't know.
export function makeDrink({ text, sugar = 0, count = 1, kcalCup = null }) {
  const name = String(text || '').trim().slice(0, 40);
  const hit = matchDrink(name);
  return {
    name,
    matched: hit ? hit.name : '',
    count: Math.min(20, Math.max(0.25, num(count, 1) || 1)),
    sugar: Math.min(20, Math.max(0, num(sugar, 0))),
    kcalCup: kcalCup !== null && kcalCup !== undefined && kcalCup !== '' ? Math.max(0, num(kcalCup)) : hit ? hit.kcal : 0,
    p: hit ? hit.p : 0,
    c: hit ? hit.c : 0,
    f: hit ? hit.f : 0,
    unknown: !hit,
    at: Date.now(),
  };
}

// Calories and macros of one entry (cups × (drink + sugar)).
export function drinkTotals(d) {
  return {
    kcal: Math.round(d.count * (d.kcalCup + d.sugar * SUGAR_TSP_KCAL)),
    p: r1(d.count * d.p),
    c: r1(d.count * (d.c + d.sugar * SUGAR_TSP_CARBS)),
    f: r1(d.count * d.f),
  };
}

// Every drink logged on a day (all meals).
export function dayDrinks(log) {
  const t = { kcal: 0, p: 0, c: 0, f: 0 };
  const all = (log && log.drinks) || {};
  for (const list of Object.values(all)) {
    for (const d of list) {
      const x = drinkTotals(d);
      t.kcal += x.kcal; t.p += x.p; t.c += x.c; t.f += x.f;
    }
  }
  return { kcal: t.kcal, p: r1(t.p), c: r1(t.c), f: r1(t.f) };
}
