// Weekly shopping list: adds up every item on the menu for a range of days and
// turns eaten amounts into what you actually buy.
//
// raw   – grams to buy per gram eaten (cooked rice ≈ 0.36 of dry, cooked
//         chicken ≈ 1.33 of raw, a banana is ~35% peel …)
// pack  – typical supermarket package; the list says how many to buy
// count – foods bought by the piece (eggs, avocados, fruit)
// split – mixed items (a "vegetable salad") broken into what goes in the cart
// Pure module: no DOM, so it is unit-tested directly.

import { FOOD_BY_ID } from './foods.js';

export const DEPTS = [
  { id: 'produce', label: 'ירקות ופירות', icon: '🥦' },
  { id: 'meat', label: 'בשר, עוף ודגים', icon: '🍗' },
  { id: 'dairy', label: 'מוצרי חלב וביצים', icon: '🥚' },
  { id: 'bakery', label: 'לחם ומאפים', icon: '🍞' },
  { id: 'dry', label: 'דגנים, קטניות ושימורים', icon: '🍚' },
  { id: 'fats', label: 'שמנים, ממרחים ואגוזים', icon: '🥜' },
  { id: 'other', label: 'שונות', icon: '🛒' },
];

const pk = (g, label) => ({ g, label });

export const SHOP = {
  chicken_breast: { dept: 'meat', name: 'חזה עוף (טרי או קפוא)', raw: 1.33 },
  turkey_breast: { dept: 'meat', name: 'חזה הודו', raw: 1.33 },
  chicken_thigh: { dept: 'meat', name: 'פרגיות ללא עור', raw: 1.35 },
  lean_beef: { dept: 'meat', name: 'בקר טחון רזה 5%', raw: 1.3, pack: pk(500, 'אריזת 500 ג׳') },
  salmon: { dept: 'meat', name: 'פילה סלמון', raw: 1.2 },
  white_fish: { dept: 'meat', name: 'פילה אמנון / מושט', raw: 1.25 },
  tuna: { dept: 'dry', name: 'טונה במים', count: { g: 112, s: 'קופסה (160 ג׳)', p: 'קופסאות (160 ג׳)' } },
  shrimp: { dept: 'meat', name: 'שרימפס קפוא', raw: 1.3 },
  turkey_pastrami: { dept: 'meat', name: 'פסטרמה הודו', pack: pk(200, 'אריזת 200 ג׳') },
  sardines: { dept: 'dry', name: 'סרדינים בשמן', count: { g: 90, s: 'קופסה', p: 'קופסאות' } },
  eggs: { dept: 'dairy', name: 'ביצים L', count: { g: 55, s: 'ביצה', p: 'ביצים' }, pack: pk(12 * 55, 'תבנית 12') },
  egg_whites: { dept: 'dairy', name: 'ביצים L (לחלבונים)', count: { g: 33, s: 'ביצה', p: 'ביצים' }, pack: pk(12 * 33, 'תבנית 12'), note: 'או חלבונים מפוסטרים בקרטון' },
  cottage: { dept: 'dairy', name: "קוטג' 5%", pack: pk(250, 'גביע 250 ג׳') },
  white_cheese: { dept: 'dairy', name: 'גבינה לבנה 5%', pack: pk(250, 'גביע 250 ג׳') },
  greek_yogurt: { dept: 'dairy', name: 'יוגורט חלבון / יווני 0%', pack: pk(200, 'גביע 200 ג׳') },
  yellow_cheese: { dept: 'dairy', name: 'גבינה צהובה 9% פרוסה', pack: pk(200, 'אריזת 200 ג׳') },
  labane: { dept: 'dairy', name: 'לבנה 5%', pack: pk(250, 'גביע 250 ג׳') },
  whey: { dept: 'other', name: 'אבקת חלבון', note: 'אריזה אחת מספיקה לכמה שבועות' },
  pea_protein: { dept: 'other', name: 'אבקת חלבון צמחית', note: 'אריזה אחת מספיקה לכמה שבועות' },
  tofu: { dept: 'dairy', name: 'טופו קשה', pack: pk(300, 'אריזת 300 ג׳') },
  tempeh: { dept: 'dairy', name: 'טמפה', pack: pk(200, 'אריזת 200 ג׳') },
  seitan: { dept: 'dairy', name: 'סייטן', pack: pk(250, 'אריזת 250 ג׳') },
  lentils: { dept: 'dry', name: 'עדשים ירוקות (יבשות)', raw: 0.4, pack: pk(500, 'שקית 500 ג׳') },
  chickpeas: { dept: 'dry', name: 'גרגרי חומוס (יבשים)', raw: 0.45, pack: pk(500, 'שקית 500 ג׳'), note: 'או שימורים: קופסה מסוננת ≈ 240 ג׳' },
  black_beans: { dept: 'dry', name: 'שעועית שחורה (יבשה)', raw: 0.42, pack: pk(500, 'שקית 500 ג׳') },
  edamame: { dept: 'other', name: 'אדממה קפואה', pack: pk(400, 'שקית 400 ג׳') },

  white_rice: { dept: 'dry', name: 'אורז לבן (יבש)', raw: 0.36, pack: pk(1000, 'שקית 1 ק״ג') },
  brown_rice: { dept: 'dry', name: 'אורז מלא (יבש)', raw: 0.34, pack: pk(1000, 'שקית 1 ק״ג') },
  quinoa: { dept: 'dry', name: 'קינואה (יבשה)', raw: 0.33, pack: pk(500, 'שקית 500 ג׳') },
  pasta: { dept: 'dry', name: 'פסטה (יבשה)', raw: 0.4, pack: pk(500, 'שקית 500 ג׳') },
  buckwheat: { dept: 'dry', name: 'כוסמת (יבשה)', raw: 0.27, pack: pk(500, 'שקית 500 ג׳') },
  bulgur: { dept: 'dry', name: 'בורגול (יבש)', raw: 0.24, pack: pk(500, 'שקית 500 ג׳') },
  couscous: { dept: 'dry', name: 'קוסקוס (יבש)', raw: 0.3, pack: pk(500, 'שקית 500 ג׳') },
  freekeh: { dept: 'dry', name: 'פריקי (יבש)', raw: 0.36, pack: pk(500, 'שקית 500 ג׳') },
  corn: { dept: 'dry', name: 'תירס מתוק', count: { g: 340, s: 'קופסת שימורים (מסוננת ≈ 340 ג׳)', p: 'קופסאות שימורים' } },
  oats: { dept: 'dry', name: 'שיבולת שועל', pack: pk(500, 'שקית 500 ג׳') },
  rice_cakes: { dept: 'dry', name: 'פריכיות אורז', pack: pk(100, 'אריזה (~11 פריכיות)') },
  sweet_potato: { dept: 'produce', name: 'בטטה', raw: 1.15 },
  potato: { dept: 'produce', name: 'תפוחי אדמה', raw: 1.05 },
  wholewheat_bread: { dept: 'bakery', name: 'לחם מלא פרוס', pack: pk(750, 'כיכר (~25 פרוסות)'), note: 'אפשר להקפיא חצי' },
  rye_bread: { dept: 'bakery', name: 'לחם שיפון פרוס', pack: pk(750, 'כיכר (~23 פרוסות)'), note: 'אפשר להקפיא חצי' },
  gf_bread: { dept: 'bakery', name: 'לחם ללא גלוטן', pack: pk(500, 'כיכר (~14 פרוסות)') },
  pita: { dept: 'bakery', name: 'פיתות מקמח מלא', count: { g: 90, s: 'פיתה', p: 'פיתות' }, pack: pk(450, 'שקית 5 פיתות') },
  tortilla: { dept: 'bakery', name: 'טורטיות מקמח מלא', count: { g: 45, s: 'טורטייה', p: 'טורטיות' }, pack: pk(360, 'אריזת 8') },

  olive_oil: { dept: 'fats', name: 'שמן זית', note: 'בקבוק אחד מספיק לחודש ויותר — בדרך כלל כבר יש בבית', staple: true },
  avocado: { dept: 'produce', name: 'אבוקדו', count: { g: 160, s: 'אבוקדו', p: 'אבוקדו' } },
  tahini: { dept: 'fats', name: 'טחינה גולמית', pack: pk(500, 'צנצנת 500 ג׳'), staple: true },
  almonds: { dept: 'fats', name: 'שקדים טבעיים', pack: pk(200, 'שקית 200 ג׳') },
  walnuts: { dept: 'fats', name: 'אגוזי מלך', pack: pk(200, 'שקית 200 ג׳') },
  cashews: { dept: 'fats', name: 'קשיו טבעי', pack: pk(200, 'שקית 200 ג׳') },
  peanut_butter: { dept: 'fats', name: 'חמאת בוטנים 100%', pack: pk(350, 'צנצנת 350 ג׳'), staple: true },
  chia: { dept: 'fats', name: "זרעי צ'יה", pack: pk(200, 'שקית 200 ג׳'), staple: true },
  flaxseed: { dept: 'fats', name: 'זרעי פשתן טחונים', pack: pk(200, 'שקית 200 ג׳'), staple: true },
  pumpkin_seeds: { dept: 'fats', name: 'גרעיני דלעת קלופים', pack: pk(200, 'שקית 200 ג׳') },
  olives: { dept: 'fats', name: 'זיתים', pack: pk(300, 'צנצנת (300 ג׳ מסונן)') },

  salad: { dept: 'produce', split: [
    { name: 'עגבניות', share: 0.4 },
    { name: 'מלפפונים', share: 0.4 },
    { name: 'פלפלים', share: 0.2 },
  ] },
  roasted_veg: { dept: 'produce', split: [
    { name: 'קישואים', share: 0.5 },
    { name: 'פלפלים', share: 0.3 },
    { name: 'בצל', share: 0.2 },
  ] },
  broccoli: { dept: 'produce', name: 'ברוקולי (טרי או קפוא)', raw: 1.2 },
  green_beans: { dept: 'produce', name: 'שעועית ירוקה (קפואה)', pack: pk(800, 'שקית 800 ג׳') },
  leafy: { dept: 'produce', name: 'עלי חסה / עלים ירוקים', pack: pk(250, 'שקית 250 ג׳') },
  carrot: { dept: 'produce', name: 'גזר', raw: 1.1 },
  spinach: { dept: 'produce', name: 'תרד (קפוא או טרי)', pack: pk(800, 'שקית 800 ג׳ קפוא') },
  cauliflower: { dept: 'produce', name: 'כרובית (טרייה או קפואה)', raw: 1.3 },
  mushrooms: { dept: 'produce', name: 'פטריות שמפיניון', pack: pk(250, 'סלסלה 250 ג׳') },

  banana: { dept: 'produce', name: 'בננות', count: { g: 120, s: 'בננה', p: 'בננות' } },
  apple: { dept: 'produce', name: 'תפוחי עץ', count: { g: 180, s: 'תפוח', p: 'תפוחים' } },
  berries: { dept: 'produce', name: 'פירות יער קפואים', pack: pk(800, 'שקית 800 ג׳') },
  orange: { dept: 'produce', name: 'תפוזים', count: { g: 160, s: 'תפוז', p: 'תפוזים' } },
  dates: { dept: 'produce', name: "תמרי מג'הול", pack: pk(500, 'קופסה 500 ג׳') },
  grapes: { dept: 'produce', name: 'ענבים', raw: 1.05 },
  pear: { dept: 'produce', name: 'אגסים', count: { g: 170, s: 'אגס', p: 'אגסים' } },
  kiwi: { dept: 'produce', name: 'קיווי', count: { g: 75, s: 'קיווי', p: 'קיווים' } },
};

export function fmtWeight(g) {
  if (g >= 1000) {
    const kg = Math.ceil(g / 100) / 10;
    return `${kg.toLocaleString('he-IL', { maximumFractionDigits: 1 })} ק״ג`;
  }
  const step = g > 200 ? 50 : g > 50 ? 10 : 5;
  return `${Math.max(step, Math.ceil(g / step) * step)} ג׳`;
}

// days: [{ day, meals }] where meals come from generateDay().
// Returns [{ dept, label, icon, items: [{ id, name, qty, need, note, staple, uses }] }]
export function buildShoppingList(days) {
  const eaten = new Map(); // foodId -> grams eaten in the range
  const uses = new Map(); // foodId -> number of servings
  for (const { meals } of days) {
    for (const meal of meals) {
      for (const it of meal.items) {
        eaten.set(it.foodId, (eaten.get(it.foodId) || 0) + it.grams);
        uses.set(it.foodId, (uses.get(it.foodId) || 0) + 1);
      }
    }
  }

  const lines = new Map(); // key -> line (split vegetables merge, e.g. peppers)
  const add = (key, line) => {
    const prev = lines.get(key);
    if (prev) {
      prev.need += line.need;
      prev.uses += line.uses;
    } else {
      lines.set(key, { ...line });
    }
  };

  for (const [foodId, grams] of eaten) {
    const food = FOOD_BY_ID[foodId];
    const info = SHOP[foodId] || { dept: 'other' };
    if (info.split) {
      for (const part of info.split) {
        add(`veg:${part.name}`, { id: `veg:${part.name}`, dept: info.dept, name: part.name, need: grams * part.share, uses: uses.get(foodId) });
      }
      continue;
    }
    add(foodId, { id: foodId, foodId, dept: info.dept, name: info.name || food.name, need: grams * (info.raw || 1), uses: uses.get(foodId) });
  }

  for (const line of lines.values()) {
    const info = SHOP[line.foodId] || {};
    line.note = info.note || '';
    line.staple = !!info.staple;
    if (info.count) {
      const n = Math.ceil(line.need / info.count.g - 0.15);
      const pieces = Math.max(1, n);
      line.qty = `${pieces} ${pieces > 1 ? info.count.p : info.count.s}`;
      if (info.pack && pieces * info.count.g > info.pack.g * 0.6) {
        const packs = Math.ceil((pieces * info.count.g) / info.pack.g);
        line.qty += ` (${packs} × ${info.pack.label})`;
      }
    } else if (info.pack) {
      const packs = Math.max(1, Math.ceil(line.need / info.pack.g - 0.1));
      line.qty = `${packs} × ${info.pack.label}`;
      line.detail = `צריך ${fmtWeight(line.need)}`;
    } else {
      line.qty = fmtWeight(line.need);
    }
  }

  return DEPTS
    .map((d) => ({
      ...d,
      items: [...lines.values()].filter((l) => l.dept === d.id).sort((a, b) => b.need - a.need),
    }))
    .filter((d) => d.items.length);
}

export function shoppingText(groups, title) {
  const out = [title, ''];
  for (const g of groups) {
    out.push(`${g.icon} ${g.label}`);
    for (const it of g.items) out.push(`☐ ${it.name} — ${it.qty}`);
    out.push('');
  }
  return out.join('\n').trim();
}
