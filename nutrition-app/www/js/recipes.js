// Recipe engine. Builds recipes for a meal out of the meal's own ingredients
// (with exactly the planned amounts) and their substitutes, combined with a
// cooking method that suits each food and a flavour profile. Spices, herbs,
// lemon and garlic are the only extras — they add no meaningful calories.
//
// A typical meal yields hundreds to thousands of distinct recipes, all offline.
// Pure module: no DOM, unit-tested directly.

import { FOOD_BY_ID, household, isAllowed } from './foods.js';
import { SHOP } from './shopping.js';
import { alternatives } from './substitutions.js';
import { rng, hashStr } from './util.js';

// ---------- short names used inside recipe titles ----------
const NAME = {
  chicken_breast: 'חזה עוף', turkey_breast: 'חזה הודו', chicken_thigh: 'פרגיות', lean_beef: 'בשר טחון',
  beef_20: 'בשר טחון', entrecote: 'אנטריקוט', salmon: 'סלמון', white_fish: 'פילה דג לבן', tuna: 'טונה',
  sardines: 'סרדינים', shrimp: 'שרימפס', eggs: 'ביצים', egg_whites: 'חלבונים', cottage: "קוטג'",
  white_cheese: 'גבינה לבנה', labane: 'לבנה', greek_yogurt: 'יוגורט', yellow_cheese: 'גבינה צהובה',
  whey: 'אבקת חלבון', pea_protein: 'אבקת חלבון צמחית', tofu: 'טופו', tempeh: 'טמפה', seitan: 'סייטן',
  lentils: 'עדשים', chickpeas: 'חומוס', black_beans: 'שעועית שחורה', edamame: 'אדממה', turkey_pastrami: 'פסטרמה',
  white_rice: 'אורז', brown_rice: 'אורז מלא', quinoa: 'קינואה', pasta: 'פסטה', sweet_potato: 'בטטה',
  potato: 'תפוחי אדמה', buckwheat: 'כוסמת', bulgur: 'בורגול', couscous: 'קוסקוס', freekeh: 'פריקי',
  wholewheat_bread: 'לחם מלא', rye_bread: 'לחם שיפון', gf_bread: 'לחם ללא גלוטן', pita: 'פיתה',
  tortilla: 'טורטייה', oats: 'שיבולת שועל', rice_cakes: 'פריכיות אורז', corn: 'תירס',
  banana: 'בננה', apple: 'תפוח', berries: 'פירות יער', orange: 'תפוז', dates: 'תמרים', grapes: 'ענבים', pear: 'אגס', kiwi: 'קיווי',
};
const nm = (id) => NAME[id] || FOOD_BY_ID[id].name;

// Definite forms ("the chicken"). Hebrew puts the article on the second word
// of a construct (חזה העוף) and on both words of noun + adjective (הגבינה
// הלבנה), so these are spelled out rather than built with a prefix.
const DEF = {
  chicken_breast: 'חזה העוף', turkey_breast: 'חזה ההודו', chicken_thigh: 'הפרגיות', lean_beef: 'הבשר הטחון',
  beef_20: 'הבשר הטחון', entrecote: 'האנטריקוט', salmon: 'הסלמון', white_fish: 'הדג', tuna: 'הטונה',
  sardines: 'הסרדינים', shrimp: 'השרימפס', eggs: 'הביצים', egg_whites: 'החלבונים', cottage: "הקוטג'",
  white_cheese: 'הגבינה הלבנה', labane: 'הלבנה', greek_yogurt: 'היוגורט', yellow_cheese: 'הגבינה הצהובה',
  whey: 'אבקת החלבון', pea_protein: 'אבקת החלבון', tofu: 'הטופו', tempeh: 'הטמפה', seitan: 'הסייטן',
  lentils: 'העדשים', chickpeas: 'החומוס', black_beans: 'השעועית', edamame: 'האדממה', turkey_pastrami: 'הפסטרמה',
  white_rice: 'האורז', brown_rice: 'האורז', quinoa: 'הקינואה', pasta: 'הפסטה', sweet_potato: 'הבטטה',
  potato: 'תפוחי האדמה', buckwheat: 'הכוסמת', bulgur: 'הבורגול', couscous: 'הקוסקוס', freekeh: 'הפריקי',
  wholewheat_bread: 'הלחם', rye_bread: 'הלחם', gf_bread: 'הלחם', pita: 'הפיתה', tortilla: 'הטורטייה',
  oats: 'שיבולת השועל', rice_cakes: 'הפריכיות', corn: 'התירס', banana: 'הבננה', apple: 'התפוח',
  berries: 'פירות היער', orange: 'התפוז', dates: 'התמרים', grapes: 'הענבים', pear: 'האגס', kiwi: 'הקיווי',
};
const def = (id) => DEF[id] || `ה${nm(id)}`;
// ב / ל + the article merge: "בפסטרמה", not "בהפסטרמה".
const inDef = (id) => { const d = def(id); return `ב${d.startsWith('ה') ? d.slice(1) : d}`; };
// Foods whose household unit already names the food ("2 ביצים").
const SELF_UNIT = new Set(['eggs', 'egg_whites']);

// Cold dishes only make sense with fresh flavours.
const FRESH = ['zaatar', 'herbs', 'greek', 'lemon_garlic', 'harissa', 'italian', 'mustard', 'mexican'];

// ---------- food kinds ----------
const KIND = {
  chicken_breast: 'poultry', turkey_breast: 'poultry', chicken_thigh: 'poultry',
  entrecote: 'steak', lean_beef: 'ground', beef_20: 'ground',
  salmon: 'fish', white_fish: 'fish', tuna: 'canfish', sardines: 'canfish', shrimp: 'shrimp',
  eggs: 'eggs', egg_whites: 'eggs',
  cottage: 'softcheese', white_cheese: 'softcheese', labane: 'softcheese', greek_yogurt: 'yogurt',
  yellow_cheese: 'slices', turkey_pastrami: 'slices',
  whey: 'powder', pea_protein: 'powder',
  tofu: 'tofu', tempeh: 'tofu', seitan: 'tofu',
  lentils: 'legume', chickpeas: 'legume', black_beans: 'legume', edamame: 'legume',
  white_rice: 'grain', brown_rice: 'grain', quinoa: 'grain', buckwheat: 'grain', bulgur: 'grain', couscous: 'grain', freekeh: 'grain',
  pasta: 'pasta', sweet_potato: 'tuber', potato: 'tuber', corn: 'corn', oats: 'oats',
  wholewheat_bread: 'bread', rye_bread: 'bread', gf_bread: 'bread', rice_cakes: 'crackers', pita: 'pita', tortilla: 'tortilla',
  banana: 'fruit', apple: 'fruit', berries: 'fruit', orange: 'fruit', dates: 'fruit', grapes: 'fruit', pear: 'fruit', kiwi: 'fruit',
};
const COOKED_CARBS = ['grain', 'pasta', 'tuber', 'corn'];

// ---------- flavour profiles ----------
// rub: how the main ingredient is seasoned; finish: the last touch.
// pantry: what the user needs at home (salt & pepper are assumed).
export const FLAVORS = [
  { id: 'lemon_garlic', label: 'לימון ושום', phrase: 'ברוטב לימון ושום', cuisine: 'med', taste: 'savory', rub: 'שום כתוש, גרידת לימון, מלח ופלפל', finish: 'סוחטים מעל חצי לימון', pantry: ['שום', 'לימון'] },
  { id: 'moroccan', label: 'מרוקאי', phrase: 'בתיבול מרוקאי', cuisine: 'mizrahi', taste: 'savory', rub: 'פפריקה מתוקה, כמון, שום כתוש ומלח', finish: 'מפזרים כוסברה קצוצה', pantry: ['פפריקה', 'כמון', 'שום', 'כוסברה'] },
  { id: 'shawarma', label: 'שווארמה', phrase: 'בתיבול שווארמה', cuisine: 'mizrahi', taste: 'savory', rub: 'תבלין שווארמה (או כורכום, כמון ופפריקה), מלח ופלפל', finish: 'מוסיפים טבעות בצל סגול', pantry: ['תבלין שווארמה', 'בצל'] },
  { id: 'zaatar', label: 'זעתר ולימון', phrase: 'בזעתר ולימון', cuisine: 'mizrahi', taste: 'savory', rub: 'זעתר, מעט לימון ומלח', finish: 'מפזרים עוד קורט זעתר', pantry: ['זעתר', 'לימון'] },
  { id: 'hawaij', label: "חוואייג' תימני", phrase: "בחוואייג' תימני", cuisine: 'mizrahi', taste: 'savory', rub: "חוואייג' למרק, כורכום ומלח", finish: 'מפזרים פטרוזיליה', pantry: ["חוואייג'", 'פטרוזיליה'] },
  { id: 'harissa', label: 'הריסה חריפה', phrase: 'בהריסה חריפה', cuisine: 'mizrahi', taste: 'savory', spicy: true, rub: 'כפית הריסה, שום ומלח', finish: 'מפזרים כוסברה', pantry: ['הריסה', 'שום', 'כוסברה'] },
  { id: 'tomato', label: 'רוטב עגבניות פיקנטי', phrase: 'ברוטב עגבניות פיקנטי', cuisine: 'mizrahi', taste: 'savory', sauce: true, rub: 'פפריקה, כמון ושום', finish: 'מפזרים פטרוזיליה', pantry: ['עגבניות מרוסקות', 'פפריקה', 'כמון', 'שום'] },
  { id: 'greek', label: 'יווני', phrase: 'בסגנון יווני', cuisine: 'med', taste: 'savory', rub: 'אורגנו, שום, לימון ומלח', finish: 'סוחטים לימון ומפזרים אורגנו', pantry: ['אורגנו', 'לימון', 'שום'] },
  { id: 'italian', label: 'איטלקי', phrase: 'בסגנון איטלקי', cuisine: 'italian', taste: 'savory', rub: 'בזיליקום, אורגנו, שום ומלח', finish: 'מפזרים עלי בזיליקום', pantry: ['בזיליקום', 'אורגנו', 'שום'] },
  { id: 'pizzaiola', label: 'פיצאיולה', phrase: 'ברוטב פיצאיולה', cuisine: 'italian', taste: 'savory', sauce: true, rub: 'שום, אורגנו ומלח', finish: 'מפזרים בזיליקום', pantry: ['עגבניות מרוסקות', 'אורגנו', 'שום'] },
  { id: 'herbs', label: 'עשבי תיבול', phrase: 'בעשבי תיבול', cuisine: 'med', taste: 'savory', rub: 'פטרוזיליה, שמיר, שום ומלח', finish: 'מפזרים עוד עשבים טריים', pantry: ['פטרוזיליה', 'שמיר', 'שום'] },
  { id: 'mustard', label: 'חרדל וטימין', phrase: 'בחרדל וטימין', cuisine: 'euro', taste: 'savory', rub: 'כפית חרדל דיז׳ון, טימין ומלח', finish: 'מפזרים טימין טרי', pantry: ['חרדל', 'טימין'] },
  { id: 'bbq', label: 'ברביקיו מעושן', phrase: 'בתיבול ברביקיו מעושן', cuisine: 'american', taste: 'savory', rub: 'פפריקה מעושנת, שום גבישי, מעט חרדל ומלח', finish: 'מפזרים בצל ירוק', pantry: ['פפריקה מעושנת', 'שום', 'חרדל'] },
  { id: 'mexican', label: 'מקסיקני', phrase: 'בסגנון מקסיקני', cuisine: 'mexican', taste: 'savory', spicy: true, rub: 'כמון, פפריקה מעושנת, צ׳ילי ומלח', finish: 'סוחטים ליים ומפזרים כוסברה', pantry: ['כמון', 'פפריקה מעושנת', 'צ׳ילי', 'ליים', 'כוסברה'] },
  { id: 'asian', label: 'אסייתי', phrase: 'בסגנון אסייתי', cuisine: 'asian', taste: 'savory', allergens: ['soy', 'gluten'], rub: 'כף רוטב סויה, ג׳ינג׳ר מגורר ושום', finish: 'מפזרים בצל ירוק ושומשום (אם אין אלרגיה)', pantry: ['רוטב סויה', 'ג׳ינג׳ר', 'שום'] },
  { id: 'thai', label: 'תאילנדי', phrase: 'בסגנון תאילנדי', cuisine: 'asian', taste: 'savory', spicy: true, rub: 'ג׳ינג׳ר, שום, צ׳ילי וגרידת ליים', finish: 'סוחטים ליים ומפזרים כוסברה', pantry: ['ג׳ינג׳ר', 'שום', 'צ׳ילי', 'ליים', 'כוסברה'] },
  { id: 'curry', label: 'קארי הודי', phrase: 'בקארי הודי', cuisine: 'indian', taste: 'savory', rub: 'אבקת קארי, כורכום, ג׳ינג׳ר ושום', finish: 'מפזרים כוסברה', pantry: ['אבקת קארי', 'כורכום', 'ג׳ינג׳ר', 'שום'] },
  { id: 'tandoori', label: 'טנדורי', phrase: 'בתיבול טנדורי', cuisine: 'indian', taste: 'savory', rub: 'פפריקה, כמון, גרם מסאלה ושום', finish: 'סוחטים לימון', pantry: ['פפריקה', 'כמון', 'גרם מסאלה', 'שום', 'לימון'] },
  { id: 'cinnamon', label: 'קינמון', phrase: 'בקינמון', cuisine: 'sweet', taste: 'sweet', rub: 'קינמון וממתיק לפי הטעם', finish: 'מפזרים עוד קורט קינמון', pantry: ['קינמון'] },
  { id: 'vanilla', label: 'וניל', phrase: 'בניחוח וניל', cuisine: 'sweet', taste: 'sweet', rub: 'כמה טיפות תמצית וניל וממתיק לפי הטעם', finish: 'מגישים קר', pantry: ['תמצית וניל'] },
  { id: 'cocoa', label: 'קקאו', phrase: 'בקקאו', cuisine: 'sweet', taste: 'sweet', rub: 'כפית אבקת קקאו וממתיק לפי הטעם', finish: 'מפזרים מעט קקאו מעל', pantry: ['אבקת קקאו'] },
  { id: 'cardamom', label: 'הל וקינמון', phrase: 'בהל וקינמון', cuisine: 'sweet', taste: 'sweet', rub: 'הל טחון, קינמון וממתיק', finish: 'מגישים חם', pantry: ['הל', 'קינמון'] },
  { id: 'coffee', label: 'קפה', phrase: 'בטעם קפה', cuisine: 'sweet', taste: 'sweet', rub: 'כפית קפה נמס מומס בכף מים חמים וממתיק לפי הטעם', finish: 'מגישים קר', pantry: ['קפה נמס'] },
  { id: 'coconut', label: 'קוקוס', phrase: 'בניחוח קוקוס', cuisine: 'sweet', taste: 'sweet', rub: 'כמה טיפות תמצית קוקוס וממתיק לפי הטעם', finish: 'מגישים קר', pantry: ['תמצית קוקוס'] },
  { id: 'gingerbread', label: 'עוגיית ג׳ינג׳ר', phrase: 'בתיבול עוגיית ג׳ינג׳ר', cuisine: 'sweet', taste: 'sweet', rub: 'ג׳ינג׳ר טחון, קינמון, קורט ציפורן וממתיק', finish: 'מפזרים קורט קינמון', pantry: ['ג׳ינג׳ר טחון', 'קינמון', 'ציפורן'] },
  { id: 'orange_blossom', label: 'מי זהר', phrase: 'במי זהר', cuisine: 'sweet', taste: 'sweet', rub: 'כפית מי זהר וממתיק לפי הטעם', finish: 'מגישים קר', pantry: ['מי זהר'] },
  { id: 'mint', label: 'נענע', phrase: 'בנענע טרייה', cuisine: 'sweet', taste: 'sweet', rub: 'כמה עלי נענע קצוצים וממתיק לפי הטעם', finish: 'מקשטים בעלה נענע', pantry: ['נענע'] },
  { id: 'lemon_zest', label: 'גרידת לימון', phrase: 'בגרידת לימון', cuisine: 'sweet', taste: 'sweet', rub: 'גרידת לימון וממתיק לפי הטעם', finish: 'מגררים מעל עוד מעט גרידה', pantry: ['לימון'] },
];

export const CUISINES = [
  { id: 'mizrahi', label: 'מזרחי / ישראלי' },
  { id: 'med', label: 'ים-תיכוני' },
  { id: 'italian', label: 'איטלקי' },
  { id: 'asian', label: 'אסייתי' },
  { id: 'mexican', label: 'מקסיקני' },
  { id: 'indian', label: 'הודי' },
  { id: 'american', label: 'ברביקיו' },
  { id: 'euro', label: 'אירופאי' },
  { id: 'sweet', label: 'מתוק' },
];

export const TOOLS = [
  { id: 'pan', label: 'מחבת' },
  { id: 'oven', label: 'תנור' },
  { id: 'pot', label: 'סיר' },
  { id: 'airfryer', label: 'אייר פרייר' },
  { id: 'grill', label: 'גריל / פסים' },
  { id: 'blender', label: 'בלנדר' },
  { id: 'nocook', label: 'בלי בישול' },
];

export const PANTRY = [...new Set(FLAVORS.flatMap((f) => f.pantry).concat(['בצל', 'עגבניות מרוסקות', 'חומץ', 'פטרוזיליה']))].sort((a, b) => a.localeCompare(b, 'he'));

// ---------- how each side is used ----------
function carbPrep(id, grams, inOven) {
  const k = KIND[id];
  const info = SHOP[id] || {};
  const dry = info.raw && info.raw < 1 ? Math.round(grams * info.raw / 5) * 5 : null;
  const n = nm(id);
  if (k === 'grain') return `מבשלים כ-${dry} ג׳ ${n} יבש${n.endsWith('ה') ? 'ה' : ''} לפי ההוראות (יוצא ${grams} ג׳ מבושל)`;
  if (k === 'pasta') return `מבשלים כ-${dry} ג׳ פסטה יבשה במים רותחים ומלוחים לפי ההוראות, ומסננים`;
  if (k === 'tuber') return inOven ? `חותכים ${grams} ג׳ ${n} לפלחים, ואופים על אותה תבנית כ-25 דקות` : `חותכים ${grams} ג׳ ${n} לקוביות ומבשלים במים מלוחים כ-15 דקות`;
  if (k === 'corn') return `מסננים ${grams} ג׳ תירס`;
  if (k === 'oats') return `מבשלים ${grams} ג׳ שיבולת שועל עם כוס מים כ-3 דקות, עד שמסמיך`;
  if (k === 'crackers') return `מגישים לצד ${household(FOOD_BY_ID[id], grams)} אורז`;
  if (k === 'bread') return `קולים ${household(FOOD_BY_ID[id], grams)} ${n}`;
  if (k === 'pita') return `מחממים ${household(FOOD_BY_ID[id], grams)} במחבת יבשה או בטוסטר`;
  if (k === 'tortilla') return `מחממים ${household(FOOD_BY_ID[id], grams)} במחבת יבשה 20 שניות מכל צד`;
  if (k === 'fruit') return `חותכים ${grams} ג׳ ${n}`;
  return null;
}

function vegPrep(id, grams, inOven) {
  if (!id) return null;
  if (id === 'salad') return `קוצצים סלט: עגבנייה, מלפפון ופלפל (${grams} ג׳ בסך הכול)`;
  if (id === 'leafy') return `מניחים מצע של ${grams} ג׳ עלים ירוקים`;
  if (id === 'carrot') return `קולפים ${grams} ג׳ גזר וחותכים למקלות`;
  if (id === 'spinach') return `מאדים ${grams} ג׳ תרד 2–3 דקות, עד שמצטמק`;
  if (id === 'mushrooms') return `פורסים ${grams} ג׳ פטריות ומקפיצים 5 דקות במחבת`;
  const name = { broccoli: 'ברוקולי', green_beans: 'שעועית ירוקה', cauliflower: 'כרובית', roasted_veg: 'קישוא, פלפל ובצל' }[id] || FOOD_BY_ID[id].name;
  return inOven ? `מניחים ${grams} ג׳ ${name} על התבנית ואופים יחד` : `מאדים או מקפיצים ${grams} ג׳ ${name} 6–8 דקות`;
}

function fatUse(id, grams, cooking) {
  if (!id) return null;
  const f = FOOD_BY_ID[id];
  const hh = household(f, grams);
  if (id === 'olive_oil') return cooking ? `משמנים במעט מתוך ${hh} שמן זית, ואת השאר מזליפים מעל בהגשה` : `מזליפים מעל ${hh} שמן זית`;
  if (id === 'butter') return cooking ? `ממיסים ${hh} חמאה במחבת` : `מורחים ${hh} חמאה`;
  if (id === 'tahini') return `מערבבים ${hh} טחינה גולמית עם מים ומעט לימון לרוטב, ומזליפים מעל`;
  if (id === 'peanut_butter') return `מוסיפים ${hh} חמאת בוטנים`;
  if (id === 'avocado') return `פורסים או מועכים ${hh} ומניחים בצד`;
  if (id === 'olives') return `מוסיפים ${hh}`;
  if (id === 'hard_cheese') return `מגררים מעל ${grams} ג׳ גבינה קשה`;
  if (['chia', 'flaxseed'].includes(id)) return `מערבבים פנימה ${hh} ${f.name}`;
  return `קולים קלות ${grams} ג׳ ${f.name} ומפזרים מעל`;
}

// ---------- cooking methods ----------
// kinds: which protein kinds; carbs: required carb kinds (null = any or none);
// absorbs: the carb is part of the dish (not a side).
const T = (o) => ({ meals: 'blds', carbs: null, absorbs: false, taste: 'savory', ...o });
const METHODS = [
  // poultry & steak
  T({ id: 'oven', kinds: ['poultry', 'steak', 'fish', 'tofu'], meals: 'ld', tool: 'oven', time: 35, cooking: true, oven: true,
    title: (c) => `${c.P} בתנור ${c.flavor.phrase}`,
    steps: (c) => [`מחממים תנור ל-200°`, `מתבלים ${c.amtP} ב${c.flavor.rub}`, c.fatStep, `אופים כ-${c.kind === 'fish' ? 15 : c.kind === 'tofu' ? 25 : 22} דקות, עד שמוכן`] }),
  T({ id: 'pan', kinds: ['poultry', 'steak', 'fish', 'tofu', 'shrimp'], meals: 'ld', tool: 'pan', time: 20, cooking: true,
    title: (c) => `${c.P} במחבת ${c.flavor.phrase}`,
    steps: (c) => [`${c.kind === 'poultry' ? 'פורסים' : 'מייבשים'} ${c.amtP}${c.kind === 'poultry' ? ' לסטייקים דקים' : ''}, ומתבלים ב${c.flavor.rub}`, c.fatStep, `צורבים במחבת חמה ${c.kind === 'steak' ? '3–4' : c.kind === 'shrimp' ? '2' : '4–5'} דקות מכל צד`, `מניחים לנוח דקה`] }),
  T({ id: 'airfryer', kinds: ['poultry', 'fish', 'tofu', 'shrimp'], meals: 'ld', tool: 'airfryer', time: 20, cooking: true,
    title: (c) => `${c.P} באייר פרייר ${c.flavor.phrase}`,
    steps: (c) => [`מתבלים ${c.amtP} ב${c.flavor.rub}`, c.fatStep, `מכניסים לאייר פרייר ב-190° ל-${c.kind === 'fish' || c.kind === 'shrimp' ? '10' : '15–18'} דקות, והופכים באמצע`] }),
  T({ id: 'grill', kinds: ['poultry', 'steak', 'fish', 'tofu'], meals: 'ld', tool: 'grill', time: 25, cooking: true,
    title: (c) => `${c.P} על הפסים ${c.flavor.phrase}`,
    steps: (c) => [`משרים ${c.amtP} ב${c.flavor.rub} לפחות 10 דקות`, c.fatStep, `צולים במחבת פסים חמה ${c.kind === 'fish' ? '3' : '5'} דקות מכל צד`] }),
  T({ id: 'skewers', kinds: ['poultry', 'steak', 'tofu', 'shrimp'], meals: 'ld', tool: 'oven', time: 30, cooking: true, oven: true,
    title: (c) => `שיפודי ${c.P} ${c.flavor.phrase}`,
    steps: (c) => [`חותכים ${c.amtP} לקוביות ומשחילים על שיפודים`, `מתבלים ב${c.flavor.rub}`, c.fatStep, `צולים בתנור על גריל עליון 12–15 דקות, והופכים פעם אחת`] }),
  T({ id: 'stirfry', kinds: ['poultry', 'steak', 'tofu', 'shrimp', 'legume'], meals: 'ld', tool: 'pan', time: 15, cooking: true,
    title: (c) => `${c.kind === 'legume' ? `${c.P} מוקפץ` : `רצועות ${c.P} מוקפצות`} ${c.flavor.phrase}${c.absorbedCarb}`, absorbsIf: ['grain', 'pasta'],
    steps: (c) => [`פורסים ${c.amtP} לרצועות`, c.fatStep, `מקפיצים על אש גבוהה 5–6 דקות עם ${c.flavor.rub}`, c.veg ? 'מוסיפים את הירקות ומקפיצים עוד 2 דקות' : null, c.absorbed ? `מוסיפים את ${c.Cd} ומערבבים` : null] }),
  T({ id: 'sauce', kinds: ['poultry', 'fish', 'tofu', 'legume', 'ground', 'eggs'], meals: 'ld', tool: 'pot', time: 30, cooking: true, needsSauce: true,
    title: (c) => (c.kind === 'eggs' ? `ביצים ${c.flavor.phrase}` : c.kind === 'fish' && c.flavor.id === 'tomato' ? `חריימה של ${c.P}` : `${c.P} ${c.flavor.phrase}`),
    steps: (c) => [c.fatStep, `מבשלים 5 דקות חצי פחית עגבניות מרוסקות עם ${c.flavor.rub}`, c.kind === 'eggs' ? `שוברים פנימה ${c.amtP}, מכסים ומבשלים 6–8 דקות` : `מוסיפים ${c.amtP} ומבשלים מכוסה ${c.kind === 'fish' ? 10 : c.kind === 'ground' ? 15 : 20} דקות`] }),
  T({ id: 'bowl', excludeFoods: ['egg_whites'], kinds: ['poultry', 'steak', 'fish', 'tofu', 'legume', 'canfish', 'shrimp', 'eggs'], meals: 'ld', tool: 'pan', time: 25, cooking: true, carbs: ['grain', 'tuber', 'corn', 'pasta'], absorbs: true,
    title: (c) => `קערת ${c.P} ו${c.C} ${c.flavor.phrase}`,
    steps: (c) => [c.kind === 'canfish' ? `מסננים ${c.amtP}` : c.kind === 'eggs' ? `מבשלים ${c.amtP} 8 דקות (קשות)` : `מתבלים ${c.amtP} ב${c.flavor.rub} ומבשלים במחבת`, `מסדרים בקערה את ${c.Cd}, את ${c.Pd} ואת הירקות`, c.fatStep] }),
  // ground meat
  T({ id: 'meatballs', kinds: ['ground'], meals: 'ld', tool: 'oven', time: 35, cooking: true, oven: true,
    title: (c) => `קציצות ${c.P} ${c.flavor.phrase}`,
    steps: (c) => [`מערבבים ${c.amtP} עם ${c.flavor.rub} ובצל קצוץ דק`, `יוצרים 6–8 קציצות`, c.fatStep, `אופים ב-200° כ-18 דקות`] }),
  T({ id: 'bolognese', kinds: ['ground'], meals: 'ld', tool: 'pot', time: 30, cooking: true, carbs: ['pasta'], absorbs: true, needsSauce: true,
    title: (c) => `פסטה בולונז ${c.flavor.phrase}`,
    steps: (c) => [c.fatStep, `מטגנים בצל קצוץ ו${c.amtP} עד שמשחים`, `מוסיפים חצי פחית עגבניות מרוסקות ו${c.flavor.rub}, ומבשלים 15 דקות`, `מערבבים עם הפסטה`] }),
  T({ id: 'stuffed_peppers', kinds: ['ground', 'legume', 'tofu'], meals: 'ld', tool: 'oven', time: 45, cooking: true, oven: true, carbs: ['grain'], absorbs: true,
    title: (c) => `פלפלים ממולאים ב${c.P} ו${c.C} ${c.flavor.phrase}`,
    steps: (c) => [`מערבבים ${c.amtP} עם ${c.Cd} ועם ${c.flavor.rub}`, `ממלאים 2 פלפלים חצויים`, c.fatStep, `אופים מכוסה ב-190° כ-30 דקות`] }),
  T({ id: 'taco', kinds: ['ground', 'poultry', 'fish', 'tofu', 'legume', 'shrimp', 'eggs'], meals: 'bld', tool: 'pan', time: 20, cooking: true, carbs: ['tortilla'], absorbs: true,
    title: (c) => `טאקו ${c.P} ${c.flavor.phrase}`,
    steps: (c) => [`מתבלים ${c.amtP} ב${c.flavor.rub} ומבשלים במחבת`, c.fatStep, `ממלאים את הטורטייה ${c.inPd} ובירקות`] }),
  // fish & canned fish
  T({ id: 'papillote', kinds: ['fish', 'shrimp'], meals: 'ld', tool: 'oven', time: 25, cooking: true, oven: true,
    title: (c) => `${c.P} בנייר אפייה ${c.flavor.phrase}`,
    steps: (c) => [`מניחים ${c.amtP} על נייר אפייה`, `מתבלים ב${c.flavor.rub}`, c.fatStep, `סוגרים לחבילה ואופים ב-200° כ-15 דקות`] }),
  T({ id: 'canfish_salad', excludeFoods: ['egg_whites'], flavors: FRESH, kinds: ['canfish', 'eggs', 'legume', 'tofu'], meals: 'blds', tool: 'nocook', time: 10,
    title: (c) => `סלט ${c.P} ${c.flavor.phrase}`,
    steps: (c) => [c.kind === 'eggs' ? `מבשלים ${c.amtP} 9 דקות, מקררים וקוצצים` : `מסננים ${c.amtP}`, `מערבבים עם הירקות הקצוצים ו${c.flavor.rub}`, c.fatStep] }),
  T({ id: 'sandwich', flavors: FRESH, kinds: ['canfish', 'slices', 'softcheese', 'eggs', 'poultry', 'tofu', 'legume'], meals: 'bls', tool: 'nocook', time: 10, carbs: ['bread', 'pita', 'crackers', 'tortilla'], absorbs: true,
    title: (c) => `${{ pita: 'פיתה', tortilla: 'רול', crackers: 'פריכיות', bread: 'כריך' }[c.carbKind]} ${c.P} ${c.flavor.phrase}`,
    steps: (c) => [c.carbStep, c.kind === 'eggs' ? (c.pid === 'egg_whites' ? `מכינים חביתה מ-${c.amtP}` : `מכינים ${c.amtP} (חביתה או קשות)`) : c.kind === 'canfish' ? `מסננים ${c.amtP} ומתבלים ב${c.flavor.rub}` : `מתבלים ${c.amtP} ב${c.flavor.rub}`, c.fatStep, `ממלאים ${c.inPd} ובירקות`] }),
  // eggs
  T({ id: 'omelette', kinds: ['eggs'], meals: 'bld', tool: 'pan', time: 10, cooking: true,
    title: (c) => `חביתה ${c.flavor.phrase}`,
    steps: (c) => [`טורפים ${c.amtP} עם ${c.flavor.rub}`, c.fatStep, `מטגנים במחבת על אש בינונית 2–3 דקות מכל צד`] }),
  T({ id: 'scramble', kinds: ['eggs', 'tofu'], meals: 'bl', tool: 'pan', time: 10, cooking: true,
    title: (c) => (c.kind === 'tofu' ? `קשקושת ${c.P} ${c.flavor.phrase}` : `ביצים מקושקשות ${c.flavor.phrase}`),
    steps: (c) => [c.kind === 'tofu' ? `מפוררים ${c.amtP} ביד` : `טורפים ${c.amtP}`, c.fatStep, `מקשקשים על אש נמוכה עם ${c.flavor.rub} עד שמוכן`] }),
  T({ id: 'frittata', kinds: ['eggs'], meals: 'bld', tool: 'oven', time: 30, cooking: true, oven: true,
    title: (c) => `פריטטה בתנור ${c.flavor.phrase}`,
    steps: (c) => [`מחממים תנור ל-180°`, `טורפים ${c.amtP} עם הירקות הקצוצים ו${c.flavor.rub}`, c.fatStep, `אופים בתבנית קטנה 20 דקות, עד שמתייצב`] }),
  T({ id: 'muffins', kinds: ['eggs'], meals: 'bs', tool: 'oven', time: 25, cooking: true, oven: true,
    title: (c) => `מאפינס ביצים ${c.flavor.phrase}`,
    steps: (c) => [`טורפים ${c.amtP} עם ירקות קצוצים ו${c.flavor.rub}`, `יוצקים לתבנית מאפינס משומנת`, `אופים ב-180° כ-18 דקות. מחזיק במקרר 3 ימים`] }),
  // dairy & powders
  T({ id: 'savory_bowl', flavors: FRESH, kinds: ['softcheese', 'yogurt'], meals: 'bsd', tool: 'nocook', time: 5,
    title: (c) => `קערת ${c.P} מלוחה ${c.flavor.phrase}`,
    steps: (c) => [`מניחים בקערה ${c.amtP}`, `מתבלים ב${c.flavor.rub}`, `מוסיפים את הירקות הקצוצים`, c.fatStep] }),
  T({ id: 'spread', flavors: FRESH, kinds: ['softcheese'], meals: 'bsd', tool: 'nocook', time: 5, carbs: ['bread', 'pita', 'crackers', 'tortilla'], absorbs: true,
    title: (c) => `${c.C} עם ממרח ${c.P} ${c.flavor.phrase}`,
    steps: (c) => [c.carbStep, `מערבבים ${c.amtP} עם ${c.flavor.rub}`, `מורחים ומניחים מעל את הירקות`, c.fatStep] }),
  T({ id: 'parfait', carbsAllowed: ['fruit', 'oats'], kinds: ['yogurt', 'softcheese'], meals: 'bs', tool: 'nocook', time: 5, taste: 'sweet',
    title: (c) => `פרפה ${c.P} ${c.flavor.phrase}`,
    steps: (c) => [`מערבבים ${c.amtP} עם ${c.flavor.rub}`, `בונים שכבות בכוס: ${c.Pd}${c.carbId ? ` ו${c.Cd}` : ''}`, c.fatStep] }),
  T({ id: 'shake', carbsAllowed: ['fruit', 'oats'], kinds: ['powder', 'yogurt', 'softcheese'], meals: 'bs', tool: 'blender', time: 5, taste: 'sweet',
    title: (c) => `שייק ${c.P} ${c.flavor.phrase}`,
    steps: (c) => [`טוחנים בבלנדר ${c.amtP} עם כוס מים קרים וקרח`, c.carbId ? `מוסיפים את ${c.Cd}` : null, `מוסיפים ${c.flavor.rub}`, c.fatStep] }),
  T({ id: 'protein_oats', kinds: ['powder', 'yogurt', 'softcheese', 'eggs'], meals: 'bs', tool: 'pot', time: 10, taste: 'sweet', carbs: ['oats'], absorbs: true,
    title: (c) => `דייסת שיבולת שועל עם ${c.P} ${c.flavor.phrase}`,
    steps: (c) => [c.carbStep, c.kind === 'eggs' ? `מוסיפים ${c.amtP} טרופים ומערבבים על אש נמוכה דקה` : `מורידים מהאש ומערבבים פנימה ${c.amtP}`, `מתבלים ב${c.flavor.rub}`, c.fatStep] }),
  T({ id: 'overnight', kinds: ['powder', 'yogurt', 'softcheese'], meals: 'bs', tool: 'nocook', time: 5, taste: 'sweet', carbs: ['oats'], absorbs: true,
    title: (c) => `שיבולת שועל של לילה עם ${c.P} ${c.flavor.phrase}`,
    steps: (c) => [`מערבבים בצנצנת ${c.carbGrams} ג׳ שיבולת שועל, ${c.amtP} וחצי כוס מים`, `מוסיפים ${c.flavor.rub}`, c.fatStep, `מכסים ומשאירים במקרר לילה`] }),
  T({ id: 'pancakes', kinds: ['powder', 'eggs', 'softcheese', 'yogurt'], meals: 'bs', tool: 'pan', time: 15, cooking: true, taste: 'sweet', carbs: ['oats', 'fruit'], absorbs: true,
    title: (c) => `פנקייק ${c.P} ${c.flavor.phrase}`,
    steps: (c) => [`טוחנים לבלילה ${c.amtP} עם ${c.Cd} ועם ${c.flavor.rub}${c.kind !== 'eggs' ? ' ומעט מים' : ''}`, c.fatStep, `מטגנים פנקייקים קטנים במחבת 2 דקות מכל צד`] }),
  // plant
  T({ id: 'stew', kinds: ['legume'], meals: 'ld', tool: 'pot', time: 35, cooking: true,
    title: (c) => `תבשיל ${c.P} ${c.flavor.phrase}`,
    steps: (c) => [c.fatStep, `מטגנים בצל ושום 3 דקות`, `מוסיפים ${c.amtP} (במשקל מבושל), ${c.flavor.rub} וכוס מים`, `מבשלים 15 דקות עד שמסמיך`] }),
  T({ id: 'soup', kinds: ['legume', 'poultry'], meals: 'ld', tool: 'pot', time: 40, cooking: true,
    title: (c) => `מרק ${c.P} ${c.flavor.phrase}`,
    steps: (c) => [c.fatStep, `מטגנים בצל קצוץ`, `מוסיפים ${c.amtP}, את הירקות, ${c.flavor.rub} ו-3 כוסות מים`, `מבשלים 25 דקות`] }),
  T({ id: 'majadra', kinds: ['legume'], meals: 'ld', tool: 'pot', time: 35, cooking: true, carbs: ['grain'], absorbs: true,
    title: (c) => `מג׳דרה של ${c.P} ו${c.C} ${c.flavor.phrase}`,
    steps: (c) => [c.fatStep, `מטגנים בצל עד שמשחים`, `מערבבים ${c.amtP} (במשקל מבושל) עם ${c.Cd} ועם ${c.flavor.rub}`, `מחממים יחד 5 דקות`] }),
  T({ id: 'patties', kinds: ['legume', 'tofu', 'canfish'], meals: 'blds', tool: 'airfryer', time: 30, cooking: true,
    title: (c) => `לביבות ${c.P} ${c.flavor.phrase}`,
    steps: (c) => [`מועכים ${c.amtP} עם ${c.flavor.rub}`, `יוצרים 4–5 לביבות שטוחות`, c.fatStep, `אופים באייר פרייר ב-190° כ-12 דקות, או בתנור 20 דקות`] }),
  T({ id: 'spread_legume', kinds: ['legume'], meals: 'blds', tool: 'blender', time: 10, flavors: [...FRESH, 'moroccan', 'curry', 'hawaij'],
    title: (c) => `ממרח ${c.P} ביתי ${c.flavor.phrase}`,
    steps: (c) => [`טוחנים ${c.amtP} (במשקל מבושל) עם 3–4 כפות מים, מעט לימון ו${c.flavor.rub} עד שחלק`, c.fatStep, `מגישים עם הירקות`] }),
  T({ id: 'warm_bowl', kinds: ['legume'], meals: 'bls', tool: 'pot', time: 10, cooking: true, flavors: [...FRESH, 'moroccan', 'hawaij', 'curry'],
    title: (c) => `קערת ${c.P} חמה ${c.flavor.phrase}`,
    steps: (c) => [`מחממים ${c.amtP} (במשקל מבושל) בסיר קטן עם חצי כוס מים ו${c.flavor.rub}`, `מועכים חלק מהקטניות במזלג כדי שיסמיך`, c.fatStep] }),
  T({ id: 'baked_tofu', kinds: ['tofu'], meals: 'ld', tool: 'oven', time: 35, cooking: true, oven: true,
    title: (c) => `קוביות ${c.P} פריכות ${c.flavor.phrase}`,
    steps: (c) => [`מייבשים ${c.amtP} במגבת וחותכים לקוביות`, `מתבלים ב${c.flavor.rub}`, c.fatStep, `אופים ב-210° כ-25 דקות`] }),
  // cold cuts / slices
  T({ id: 'rolls', flavors: FRESH, kinds: ['slices'], meals: 'bls', tool: 'nocook', time: 5,
    title: (c) => `רולים של ${c.P} ${c.flavor.phrase}`,
    steps: (c) => [`פורשים ${c.amtP}`, `מתבלים ב${c.flavor.rub}`, `מגלגלים עם הירקות`, c.fatStep] }),
  T({ id: 'toast', kinds: ['slices', 'softcheese', 'eggs', 'canfish'], meals: 'bls', tool: 'oven', time: 10, cooking: true, carbs: ['bread', 'pita', 'tortilla'], absorbs: true,
    title: (c) => `טוסט ${c.P} ${c.flavor.phrase}`,
    steps: (c) => [`ממלאים את ${c.Cd} ${c.inAmt} ומתבלים ב${c.flavor.rub}`, c.fatStep, `קולים בטוסטר או במחבת עד שזהוב`] }),
];

// ---------- building recipes ----------

function itemOf(meal, role) {
  return meal.items.find((i) => i.role === role || (role === 'carb' && i.role === 'fruit'));
}

// Options for one slot: the planned food first, then equivalents.
function optionsFor(meal, item, prefs, max) {
  if (!item) return [null];
  const out = [{ foodId: item.foodId, grams: item.grams, swapped: false, slot: item.slot }];
  if (max > 0) {
    for (const o of alternatives(item, meal, prefs, max).options) out.push({ foodId: o.foodId, grams: o.grams, swapped: true, slot: item.slot });
  }
  return out;
}

function flavorOk(flavor, prefs) {
  const allergies = prefs.allergies || [];
  return !(flavor.allergens || []).some((a) => allergies.includes(a));
}

// All recipes for a meal. Returns plain objects, deterministic for (meal, day).
export function recipesForMeal(meal, prefs, { day = '', withSubs = true } = {}) {
  const pItem = meal.items.find((i) => i.slot === 'protein') || itemOf(meal, 'protein');
  if (!pItem) return [];
  const cItem = meal.items.find((i) => i.slot === 'carb') || itemOf(meal, 'carb');
  const fItem = meal.items.find((i) => i.role === 'fat');
  const vItem = meal.items.find((i) => i.role === 'veg');
  const extra = meal.items.find((i) => i.slot === 'protein2');

  const proteins = optionsFor(meal, pItem, prefs, withSubs ? 6 : 0);
  const carbs = optionsFor(meal, cItem, prefs, withSubs ? 4 : 0);
  const out = [];
  for (const p of proteins) {
    if (!isAllowed(FOOD_BY_ID[p.foodId], prefs)) continue;
    const kind = KIND[p.foodId];
    for (const c of carbs) {
      const carbKind = c ? KIND[c.foodId] : null;
      for (const m of METHODS) {
        if (!m.kinds.includes(kind) || !m.meals.includes(meal.type)) continue;
        if (m.carbs && !(c && m.carbs.includes(carbKind))) continue;
        if (m.carbsAllowed && c && !m.carbsAllowed.includes(carbKind)) continue;
        if (m.excludeFoods && m.excludeFoods.includes(p.foodId)) continue;
        // Oats belong in porridge, shakes and pancakes, not beside a savoury dish.
        if (carbKind === 'oats' && m.taste === 'savory' && !(m.carbs || []).includes('oats')) continue;
        const absorbed = m.absorbs || (m.absorbsIf && c && m.absorbsIf.includes(carbKind));
        for (const flavor of FLAVORS) {
          if (!flavorOk(flavor, prefs)) continue;
          if (m.flavors && !m.flavors.includes(flavor.id)) continue;
          const sweetMeal = meal.type === 'b' || meal.type === 's';
          if (flavor.taste !== m.taste) continue;
          if (flavor.taste === 'sweet' && !sweetMeal) continue;
          if (m.needsSauce && !flavor.sauce && !['curry', 'moroccan', 'hawaij', 'harissa', 'thai'].includes(flavor.id)) continue;
          if (!m.needsSauce && flavor.sauce && !['oven', 'bowl', 'meatballs', 'pan'].includes(m.id)) continue;
          out.push(makeRecipe({ meal, m, flavor, p, c, fItem, vItem, extra, carbKind, absorbed, kind }));
        }
      }
    }
  }
  // Stable, varied order: recipes with the planned ingredients first, then
  // the rest, each shuffled by day so the list feels fresh every day.
  const r = rng(hashStr(`recipes|${day}|${meal.index}`));
  const keyed = out.map((x) => ({ x, k: (x.swaps.length ? 1 : 0) + r() }));
  keyed.sort((a, b) => a.k - b.k);
  const seen = new Set();
  return keyed.map((k) => k.x).filter((x) => (seen.has(x.title) ? false : seen.add(x.title)));
}

function makeRecipe({ meal, m, flavor, p, c, fItem, vItem, extra, carbKind, absorbed, kind }) {
  const P = nm(p.foodId);
  const C = c ? nm(c.foodId) : '';
  const pFood = FOOD_BY_ID[p.foodId];
  const amt = pFood.discrete ? household(pFood, p.grams) : `${p.grams} ג׳`;
  const amtP = SELF_UNIT.has(p.foodId) ? amt : `${amt} ${P}`;
  const carbStep = c ? carbPrep(c.foodId, c.grams, !!m.oven) : null;
  const ctx = {
    P, C, kind, flavor, amt, amtP,
    pid: p.foodId,
    inAmt: /^[\d½¼¾]/.test(amtP) ? `ב-${amtP}` : `ב${amtP}`,
    Pd: def(p.foodId),
    inPd: inDef(p.foodId),
    Cd: c ? def(c.foodId) : '',
    carbId: c ? c.foodId : null,
    carbKind,
    carbGrams: c ? c.grams : 0,
    carbStep,
    absorbed,
    absorbedCarb: absorbed && c ? ` עם ${C}` : '',
    veg: vItem ? vItem.foodId : null,
    fatStep: fItem ? fatUse(fItem.foodId, fItem.grams, !!m.cooking) : null,
  };
  let title = m.title(ctx);
  // Fruit beside a savoury dish is dessert, not part of the dish's name.
  const fruitDessert = c && carbKind === 'fruit' && m.taste === 'savory' && !absorbed;
  if (c && !absorbed && !fruitDessert && !m.carbs && !title.includes(C)) title += ` עם ${C}`;
  title = title.replace(/\s+/g, ' ').trim();

  const steps = [];
  if (c && !absorbed && carbStep && !fruitDessert) steps.push(carbStep);
  if (vItem) {
    const v = vegPrep(vItem.foodId, vItem.grams, !!m.oven);
    if (v) steps.push(v);
  }
  for (const s of m.steps(ctx)) if (s) steps.push(s);
  if (extra) {
    const hh = household(FOOD_BY_ID[extra.foodId], extra.grams);
    steps.push(`מוסיפים לצד ${SELF_UNIT.has(extra.foodId) ? hh : `${hh} ${nm(extra.foodId)}`} להשלמת החלבון`);
  }
  steps.push(flavor.finish.startsWith('מגישים') ? flavor.finish : `${flavor.finish}, ומגישים`);
  if (fruitDessert) steps.push(`לקינוח: ${c.grams} ג׳ ${nm(c.foodId)}`);

  const ingredients = [{ foodId: p.foodId, grams: p.grams }];
  if (c) ingredients.push({ foodId: c.foodId, grams: c.grams });
  if (extra) ingredients.push({ foodId: extra.foodId, grams: extra.grams });
  if (fItem) ingredients.push({ foodId: fItem.foodId, grams: fItem.grams });
  if (vItem) ingredients.push({ foodId: vItem.foodId, grams: vItem.grams });

  const pantry = [...new Set([...flavor.pantry, ...(m.needsSauce ? ['עגבניות מרוסקות'] : []), ...(['meatballs', 'stew', 'soup', 'majadra', 'bolognese'].includes(m.id) ? ['בצל'] : [])])];
  const swaps = [p, c].filter((x) => x && x.swapped).map((x) => ({ slot: x.slot, foodId: x.foodId, grams: x.grams }));
  return {
    id: `${meal.type}|${p.foodId}|${c ? c.foodId : '-'}|${m.id}|${flavor.id}`,
    title,
    method: m.id,
    tool: m.tool,
    time: m.time + (c && !absorbed && COOKED_CARBS.includes(carbKind) && !m.oven ? 5 : 0),
    cuisine: flavor.cuisine,
    flavor: flavor.id,
    flavorLabel: flavor.label,
    spicy: !!flavor.spicy,
    ingredients: ingredients.map((i) => ({ ...i, name: FOOD_BY_ID[i.foodId].name, household: household(FOOD_BY_ID[i.foodId], i.grams) })),
    pantry,
    steps,
    swaps,
  };
}

// filters: { cuisines: [], tools: [], maxTime: 0|10|20|40, pantryOnly: bool,
//            have: [], favorites: bool, favIds: [], q: '' , noSpicy: bool }
export function filterRecipes(list, f = {}) {
  const have = new Set(f.have || []);
  const fav = new Set(f.favIds || []);
  const q = (f.q || '').trim();
  return list.filter((r) => {
    if (f.cuisines && f.cuisines.length && !f.cuisines.includes(r.cuisine)) return false;
    if (f.tools && f.tools.length && !f.tools.includes(r.tool)) return false;
    if (f.maxTime && r.time > f.maxTime) return false;
    if (f.noSpicy && r.spicy) return false;
    if (f.pantryOnly && !r.pantry.every((p) => have.has(p))) return false;
    if (f.favorites && !fav.has(r.id)) return false;
    if (f.noSwaps && r.swaps.length) return false;
    if (q && !(r.title.includes(q) || r.ingredients.some((i) => i.name.includes(q)) || r.pantry.some((p) => p.includes(q)))) return false;
    return true;
  });
}
