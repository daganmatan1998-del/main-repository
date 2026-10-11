// Drinks: what the person drank with a meal, as free text. The text is matched
// against a small table of common drinks (per cup of 250 ml unless noted) to
// get calories; anything it doesn't know is saved with 0 calories and the
// person can type the calories per cup themselves. Sugar and the number of
// cups are optional.

import { normText } from './util.js';

export const SUGAR_TSP_KCAL = 16; // one level teaspoon of sugar: 4 g
export const SUGAR_TSP_CARBS = 4;

// kcal / macros per cup. `keys`: words that identify the drink (the longest
// match in the text wins), so "קפה עם חלב" beats the plain "קפה".
const DRINKS = [
  { name: 'מים', keys: ['מים', 'מים מינרליים', 'סודה', 'מי סודה', 'מים עם לימון'], kcal: 0, p: 0, c: 0, f: 0 },
  { name: 'תה (בלי סוכר)', keys: ['תה', 'תה ירוק', 'תה נענע', 'תה צמחים', 'חליטה'], kcal: 2, p: 0, c: 0.5, f: 0 },
  { name: 'קפה שחור', keys: ['קפה שחור', 'אספרסו', 'אמריקנו', 'קפה בלי חלב', 'נס קפה שחור', 'קפה טורקי', 'קפה נמס', 'קפה'], kcal: 3, p: 0.2, c: 0.4, f: 0 },
  { name: 'קפה עם טיפת חלב', keys: ['קפה עם חלב', 'קפה עם טיפת חלב', 'נס קפה עם חלב', 'נס קפה', 'קפה בטעם'], kcal: 35, p: 1.8, c: 2.5, f: 1.8 },
  { name: 'קפה הפוך / לאטה', keys: ['הפוך', 'לאטה', 'קפה הפוך', 'קפוצינו', 'קפוצ׳ינו', 'קפה לאטה', 'מקיאטו גדול'], kcal: 120, p: 6, c: 9, f: 6 },
  { name: 'קפה קר', keys: ['קפה קר', 'אייס קפה', 'אייס לאטה', 'קפה בקרח'], kcal: 110, p: 4, c: 17, f: 3 },
  { name: 'שוקו', keys: ['שוקו', 'שוקו חם', 'שוקו קר', 'קקאו', 'שוקו תנובה'], kcal: 170, p: 8, c: 24, f: 5 },
  { name: 'חלב 3%', keys: ['חלב', 'חלב 3%', 'כוס חלב'], kcal: 150, p: 8, c: 12, f: 8 },
  { name: 'חלב 1%', keys: ['חלב 1%', 'חלב דל שומן'], kcal: 110, p: 8, c: 12, f: 2.5 },
  { name: 'חלב סויה', keys: ['חלב סויה', 'משקה סויה'], kcal: 90, p: 7, c: 4, f: 4 },
  { name: 'חלב שקדים (לא ממותק)', keys: ['חלב שקדים', 'משקה שקדים'], kcal: 30, p: 1, c: 1, f: 2.5 },
  { name: 'חלב שיבולת שועל', keys: ['חלב שיבולת שועל', 'חלב שיבולת', 'משקה שיבולת'], kcal: 120, p: 3, c: 16, f: 5 },
  { name: 'שייק חלבון', keys: ['שייק חלבון', 'שייק', 'משקה חלבון', 'פרוטאין'], kcal: 200, p: 25, c: 10, f: 5 },
  { name: 'סמודי פירות', keys: ['סמודי', 'סמוזי', 'שייק פירות'], kcal: 170, p: 3, c: 38, f: 1 },
  { name: 'מיץ תפוזים טבעי', keys: ['מיץ תפוזים', 'תפוזים סחוט', 'מיץ תפוז', 'מיץ'], kcal: 110, p: 2, c: 26, f: 0.5 },
  { name: 'מיץ תפוחים / ענבים', keys: ['מיץ תפוחים', 'מיץ ענבים', 'מיץ פירות', 'פריגת', 'פרימור'], kcal: 115, p: 0.3, c: 28, f: 0 },
  { name: 'לימונדה / מיץ ממותק', keys: ['לימונדה', 'שתיה ממותקת', 'משקה ממותק', 'ליפטון', 'אייס טי', 'תה קר', 'סירופ'], kcal: 90, p: 0, c: 23, f: 0 },
  { name: 'קולה / משקה מוגז ממותק', keys: ['קולה', 'קוקה קולה', 'פפסי', 'ספרייט', 'פאנטה', 'משקה מוגז', 'סודה ממותקת', 'שוופס', 'מוגז'], kcal: 105, p: 0, c: 26, f: 0 },
  { name: 'משקה דיאט / זירו', keys: ['זירו', 'דיאט', 'קולה זירו', 'קולה דיאט', 'מקס', 'משקה דיאט', 'סודה דיאט'], kcal: 2, p: 0, c: 0, f: 0 },
  { name: 'משקה אנרגיה', keys: ['משקה אנרגיה', 'רד בול', 'XL', 'מונסטר', 'אנרגיה'], kcal: 110, p: 0, c: 27, f: 0 },
  { name: 'משקה איזוטוני / ספורט', keys: ['איזוטוני', 'גטורייד', 'משקה ספורט', 'פאוורייד'], kcal: 60, p: 0, c: 15, f: 0 },
  { name: 'יוגורט שתייה', keys: ['יוגורט שתיה', 'יוגורט שתייה', 'דנונינו שתיה', 'שתיית יוגורט', 'קפיר', 'ביו שתיה', 'שתיה חלבית'], kcal: 130, p: 7, c: 18, f: 3 },
  { name: 'בירה (כוס)', keys: ['בירה', 'גולדסטאר', 'מלכה', 'קורונה', 'בירה קלה'], kcal: 110, p: 1, c: 9, f: 0 },
  { name: 'יין (כוס קטנה)', keys: ['יין', 'יין אדום', 'יין לבן', 'רוזה'], kcal: 125, p: 0, c: 4, f: 0 },
  { name: 'משקה חריף (שוט)', keys: ['וודקה', 'ויסקי', 'ערק', 'ג׳ין', 'ג׳ין טוניק', 'שוט', 'טקילה', 'רום', 'קוקטייל', 'ליקר'], kcal: 100, p: 0, c: 1, f: 0 },
].map((d) => ({ ...d, normKeys: d.keys.map(normText) }));

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
