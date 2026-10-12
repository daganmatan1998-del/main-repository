// Weekly shopping list: adds up every item on the menu for a range of days and
// turns eaten amounts into what you actually buy.
//
// raw   – grams to buy per gram eaten (cooked rice ≈ 0.36 of dry, cooked
//         chicken ≈ 1.33 of raw, a banana is ~35% peel …)
// pack  – typical supermarket package; the list says how many to buy
// count – foods bought by the piece (eggs, avocados, fruit)
// split – mixed items (a "vegetable salad") broken into what goes in the cart
// Pure module: no DOM, so it is unit-tested directly.

import { format, raw, t as tr, locale } from './i18n.js';
import { FOOD_BY_ID } from './foods.js';

export const DEPTS = [
  { id: 'produce', label: tr('Fruits and vegetables'), icon: '🥦' },
  { id: 'meat', label: tr('Meat, poultry and fish'), icon: '🍗' },
  { id: 'dairy', label: tr('Dairy and eggs'), icon: '🥚' },
  { id: 'bakery', label: tr('Bread and baked goods'), icon: '🍞' },
  { id: 'dry', label: tr('Grains, legumes and canned goods'), icon: '🍚' },
  { id: 'fats', label: tr('Oils, spreads and nuts'), icon: '🥜' },
  { id: 'other', label: tr('Other'), icon: '🛒' },
];

const pk = (g, label) => ({ g, label });

export const SHOP = {
  chicken_breast: { dept: 'meat', name: tr('Chicken breast (fresh or frozen)'), raw: 1.33 },
  turkey_breast: { dept: 'meat', name: tr('Turkey breast'), raw: 1.33 },
  chicken_thigh: { dept: 'meat', name: tr('Skinless chicken thighs'), raw: 1.35 },
  lean_beef: { dept: 'meat', name: tr('Lean ground beef 5%'), raw: 1.3, pack: pk(500, tr('500 g pack')) },
  salmon: { dept: 'meat', name: tr('Salmon fillet'), raw: 1.2 },
  white_fish: { dept: 'meat', name: tr('Tilapia / St. Peter\'s fish fillet'), raw: 1.25 },
  tuna: { dept: 'dry', name: tr('Tuna in water'), count: { g: 112, u: raw('{0, plural, =0.25 {{1} can (160 g)} =0.5 {{1} can (160 g)} =0.75 {{1} can (160 g)} one {{1} can (160 g)} other {{1} cans (160 g)}}') } },
  shrimp: { dept: 'meat', name: tr('Frozen shrimp'), raw: 1.3 },
  turkey_pastrami: { dept: 'meat', name: tr('Turkey pastrami'), pack: pk(200, tr('200 g pack')) },
  sardines: { dept: 'dry', name: tr('Sardines in oil'), count: { g: 90, u: raw('{0, plural, =0.25 {{1} can} =0.5 {{1} can} =0.75 {{1} can} one {{1} can} other {{1} cans}}') } },
  eggs: { dept: 'dairy', name: tr('Eggs L'), count: { g: 55, u: raw('{0, plural, =0.25 {{1} egg} =0.5 {{1} egg} =0.75 {{1} egg} one {{1} egg} other {{1} Eggs}}') }, pack: pk(12 * 55, tr('tray of 12')) },
  egg_whites: { dept: 'dairy', name: tr('Eggs L (for whites)'), count: { g: 33, u: raw('{0, plural, =0.25 {{1} egg} =0.5 {{1} egg} =0.75 {{1} egg} one {{1} egg} other {{1} Eggs}}') }, pack: pk(12 * 33, tr('tray of 12')), note: tr('Or pasteurized egg whites in a carton') },
  cottage: { dept: 'dairy', name: tr('Cottage cheese 5%'), pack: pk(250, tr('250 g tub')) },
  white_cheese: { dept: 'dairy', name: tr('Soft white cheese 5%'), pack: pk(250, tr('250 g tub')) },
  greek_yogurt: { dept: 'dairy', name: tr('Protein / Greek yogurt 0%'), pack: pk(200, tr('200 g tub')) },
  yellow_cheese: { dept: 'dairy', name: tr('Sliced yellow cheese 9%'), pack: pk(200, tr('200 g pack')) },
  labane: { dept: 'dairy', name: tr('Labneh 5%'), pack: pk(250, tr('250 g tub')) },
  whey: { dept: 'other', name: tr('protein powder'), note: tr('One pack lasts several weeks') },
  pea_protein: { dept: 'other', name: tr('Plant protein powder'), note: tr('One pack lasts several weeks') },
  tofu: { dept: 'dairy', name: tr('Firm tofu'), pack: pk(300, tr('300 g pack')) },
  tempeh: { dept: 'dairy', name: tr('Tempeh'), pack: pk(200, tr('200 g pack')) },
  seitan: { dept: 'dairy', name: tr('Seitan'), pack: pk(250, tr('250 g pack')) },
  lentils: { dept: 'dry', name: tr('Green lentils (dry)'), raw: 0.4, pack: pk(500, tr('500 g bag')) },
  chickpeas: { dept: 'dry', name: tr('Chickpeas (dry)'), raw: 0.45, pack: pk(500, tr('500 g bag')), note: tr('Or canned: 1 can, drained ≈ 240 g') },
  black_beans: { dept: 'dry', name: tr('Black beans (dry)'), raw: 0.42, pack: pk(500, tr('500 g bag')) },
  entrecote: { dept: 'meat', name: tr('entrecote'), raw: 1.3 },
  beef_20: { dept: 'meat', name: tr('Ground beef 20%'), raw: 1.3, pack: pk(500, tr('500 g pack')) },
  edamame: { dept: 'other', name: tr('Frozen edamame'), pack: pk(400, tr('400 g bag')) },
  ground_chicken: { dept: 'meat', name: tr('ground chicken'), raw: 1.3, pack: pk(500, tr('500 g pack')) },
  ground_turkey: { dept: 'meat', name: tr('ground turkey'), raw: 1.3, pack: pk(500, tr('500 g pack')) },
  sirloin: { dept: 'meat', name: tr('sirloin'), raw: 1.3 },
  trout: { dept: 'meat', name: tr('Trout fillet'), raw: 1.2 },
  hake: { dept: 'meat', name: tr('Frozen hake (cod) fillet'), raw: 1.25 },
  bulgarian: { dept: 'dairy', name: tr('Bulgarian cheese 5%'), pack: pk(250, tr('250 g tub')) },
  skyr: { dept: 'dairy', name: tr('Skyr / quark 0%'), pack: pk(150, tr('150 g tub')) },
  pro_pudding: { dept: 'dairy', name: tr('protein dessert'), pack: pk(200, tr('200 g tub')) },
  soy_chunks: { dept: 'dry', name: tr('Soybeans (dry)'), raw: 0.33, pack: pk(200, tr('200 g bag')), note: tr('Soak in boiling water for 10 minutes before cooking') },
  white_beans: { dept: 'dry', name: tr('White beans (dry)'), raw: 0.4, pack: pk(500, tr('500 g bag')), note: tr('Or canned: 1 can, drained ≈ 240 g') },

  white_rice: { dept: 'dry', name: tr('White rice (dry)'), raw: 0.36, pack: pk(1000, tr('1 kg bag')) },
  brown_rice: { dept: 'dry', name: tr('Brown rice (dry)'), raw: 0.34, pack: pk(1000, tr('1 kg bag')) },
  quinoa: { dept: 'dry', name: tr('Quinoa (dry)'), raw: 0.33, pack: pk(500, tr('500 g bag')) },
  pasta: { dept: 'dry', name: tr('Pasta (dry)'), raw: 0.4, pack: pk(500, tr('500 g bag')) },
  buckwheat: { dept: 'dry', name: tr('Buckwheat (dry)'), raw: 0.27, pack: pk(500, tr('500 g bag')) },
  bulgur: { dept: 'dry', name: tr('Bulgur (dry)'), raw: 0.24, pack: pk(500, tr('500 g bag')) },
  couscous: { dept: 'dry', name: tr('Couscous (dry)'), raw: 0.3, pack: pk(500, tr('500 g bag')) },
  freekeh: { dept: 'dry', name: tr('Freekeh (dry)'), raw: 0.36, pack: pk(500, tr('500 g bag')) },
  corn: { dept: 'dry', name: tr('Sweet corn'), count: { g: 340, u: raw('{0, plural, =0.25 {{1} can (drained ≈ 340 g)} =0.5 {{1} can (drained ≈ 340 g)} =0.75 {{1} can (drained ≈ 340 g)} one {{1} can (drained ≈ 340 g)} other {{1} cans}}') } },
  oats: { dept: 'dry', name: tr('Oats'), pack: pk(500, tr('500 g bag')) },
  rice_cakes: { dept: 'dry', name: tr('Rice cakes'), pack: pk(100, tr('pack (~11 rice cakes)')) },
  sweet_potato: { dept: 'produce', name: tr('sweet potato'), raw: 1.15 },
  potato: { dept: 'produce', name: tr('potatoes'), raw: 1.05 },
  wholewheat_bread: { dept: 'bakery', name: tr('Sliced whole wheat bread'), pack: pk(750, tr('loaf (~25 slices)')), note: tr('You can freeze half') },
  rye_bread: { dept: 'bakery', name: tr('Sliced rye bread'), pack: pk(750, tr('loaf (~23 slices)')), note: tr('You can freeze half') },
  gf_bread: { dept: 'bakery', name: tr('Gluten-free bread'), pack: pk(500, tr('loaf (~14 slices)')) },
  pita: { dept: 'bakery', name: tr('Whole wheat pitas'), count: { g: 90, u: raw('{0, plural, =0.25 {{1} pita} =0.5 {{1} pita} =0.75 {{1} pita} one {{1} pita} other {{1} pitas}}') }, pack: pk(450, tr('bag of 5 pitas')) },
  tortilla: { dept: 'bakery', name: tr('Whole wheat tortillas'), count: { g: 45, u: raw('{0, plural, =0.25 {{1} tortilla} =0.5 {{1} tortilla} =0.75 {{1} tortilla} one {{1} tortilla} other {{1} tortillas}}') }, pack: pk(360, tr('pack of 8')) },
  barley: { dept: 'dry', name: tr('Pearl barley (dry)'), raw: 0.29, pack: pk(500, tr('500 g bag')) },
  millet: { dept: 'dry', name: tr('Millet (dry)'), raw: 0.29, pack: pk(500, tr('500 g bag')) },
  ptitim: { dept: 'dry', name: tr('Israeli couscous (dry)'), raw: 0.42, pack: pk(500, tr('500 g bag')) },
  whole_pasta: { dept: 'dry', name: tr('Whole wheat pasta (dry)'), raw: 0.42, pack: pk(500, tr('500 g bag')) },
  gf_pasta: { dept: 'dry', name: tr('Gluten-free pasta (dry)'), raw: 0.42, pack: pk(400, tr('400 g bag')) },
  rice_noodles: { dept: 'dry', name: tr('Rice noodles (dry)'), raw: 0.33, pack: pk(400, tr('400 g bag')) },
  green_peas: { dept: 'produce', name: tr('Frozen green peas'), pack: pk(800, tr('800 g bag')) },
  whole_bun: { dept: 'bakery', name: tr('Whole wheat rolls'), count: { g: 60, u: raw('{0, plural, =0.25 {{1} bun} =0.5 {{1} bun} =0.75 {{1} bun} one {{1} bun} other {{1} buns}}') }, pack: pk(360, tr('bag of 6')) },
  crispbread: { dept: 'bakery', name: tr('Whole wheat crispbread'), pack: pk(275, tr('pack (~25 slices)')) },

  olive_oil: { dept: 'fats', name: tr('Olive oil'), note: tr('One bottle lasts a month or more, and you usually already have it at home'), staple: true },
  avocado: { dept: 'produce', name: tr('Avocado'), count: { g: 160, u: raw('{0, plural, =0.25 {{1} Avocado} =0.5 {{1} Avocado} =0.75 {{1} Avocado} one {{1} Avocado} other {{1} Avocado}}') } },
  tahini: { dept: 'fats', name: tr('Raw tahini'), pack: pk(500, tr('500 g jar')), staple: true },
  almonds: { dept: 'fats', name: tr('Natural almonds'), pack: pk(200, tr('200 g bag')) },
  walnuts: { dept: 'fats', name: tr('Walnuts'), pack: pk(200, tr('200 g bag')) },
  cashews: { dept: 'fats', name: tr('Natural cashews'), pack: pk(200, tr('200 g bag')) },
  peanut_butter: { dept: 'fats', name: tr('Peanut butter 100%'), pack: pk(350, tr('350 g jar')), staple: true },
  chia: { dept: 'fats', name: tr('Chia seeds'), pack: pk(200, tr('200 g bag')), staple: true },
  flaxseed: { dept: 'fats', name: tr('Ground flaxseed'), pack: pk(200, tr('200 g bag')), staple: true },
  pumpkin_seeds: { dept: 'fats', name: tr('Hulled pumpkin seeds'), pack: pk(200, tr('200 g bag')) },
  olives: { dept: 'fats', name: tr('Olives'), pack: pk(300, tr('jar (300 g drained)')) },
  butter: { dept: 'dairy', name: tr('Butter'), pack: pk(200, tr('200 g pack‖shopping:CallExpression')) },
  hard_cheese: { dept: 'dairy', name: tr('Hard cheese (Parmesan / cheddar)'), pack: pk(200, tr('200 g pack')) },
  pistachios: { dept: 'fats', name: tr('Shelled pistachios'), pack: pk(200, tr('200 g bag')) },
  hazelnuts: { dept: 'fats', name: tr('Hazelnuts'), pack: pk(200, tr('200 g bag')) },
  peanuts: { dept: 'fats', name: tr('Unsalted roasted peanuts'), pack: pk(200, tr('200 g bag')) },
  sunflower_seeds: { dept: 'fats', name: tr('Hulled sunflower seeds'), pack: pk(200, tr('200 g bag')) },
  sesame_seeds: { dept: 'fats', name: tr('sesame'), pack: pk(200, tr('200 g bag')), staple: true },
  almond_butter: { dept: 'fats', name: tr('Almond butter 100%'), pack: pk(250, tr('250 g jar')), staple: true },
  canola_oil: { dept: 'fats', name: tr('Canola oil'), note: tr('One bottle lasts a month or more, and you usually already have it at home'), staple: true },
  hummus_spread: { dept: 'dairy', name: tr('Hummus spread'), pack: pk(400, tr('400 g tub')) },
  mozzarella: { dept: 'dairy', name: tr('Mozzarella'), pack: pk(125, tr('125 g pack')) },
  feta: { dept: 'dairy', name: tr('Feta cheese'), pack: pk(200, tr('200 g pack')) },
  cream_cheese: { dept: 'dairy', name: tr('Cream cheese 30%'), pack: pk(200, tr('200 g tub')) },
  ghee: { dept: 'fats', name: tr('Ghee (clarified butter)'), pack: pk(300, tr('300 g jar')), staple: true },

  salad: { dept: 'produce', split: [
    { name: tr('Tomatoes'), share: 0.4 },
    { name: tr('Cucumbers'), share: 0.4 },
    { name: tr('Bell peppers'), share: 0.2 },
  ] },
  roasted_veg: { dept: 'produce', split: [
    { name: tr('Zucchini'), share: 0.5 },
    { name: tr('Bell peppers'), share: 0.3 },
    { name: tr('onion'), share: 0.2 },
  ] },
  broccoli: { dept: 'produce', name: tr('Broccoli (fresh or frozen)'), raw: 1.2 },
  green_beans: { dept: 'produce', name: tr('Green beans (frozen)'), pack: pk(800, tr('800 g bag')) },
  leafy: { dept: 'produce', name: tr('Lettuce leaves / leafy greens'), pack: pk(250, tr('250 g bag')) },
  carrot: { dept: 'produce', name: tr('Carrot'), raw: 1.1 },
  spinach: { dept: 'produce', name: tr('Spinach (frozen or fresh)'), pack: pk(800, tr('800 g frozen bag')) },
  cauliflower: { dept: 'produce', name: tr('Cauliflower (fresh or frozen)'), raw: 1.3 },
  mushrooms: { dept: 'produce', name: tr('White button mushrooms'), pack: pk(250, tr('250 g container')) },
  cucumber: { dept: 'produce', name: tr('Cucumbers'), raw: 1.05 },
  tomato: { dept: 'produce', name: tr('Tomatoes'), raw: 1.05 },
  peppers: { dept: 'produce', name: tr('Bell peppers (mixed colors)'), raw: 1.15 },
  zucchini: { dept: 'produce', name: tr('Zucchini'), raw: 1.05 },
  eggplant: { dept: 'produce', name: tr('Eggplants'), raw: 1.6 },
  cabbage: { dept: 'produce', name: tr('Cabbage (or bag of shredded cabbage)'), raw: 1.1 },
  asparagus: { dept: 'produce', name: tr('asparagus'), raw: 1.3 },
  brussels: { dept: 'produce', name: tr('Brussels sprouts (fresh or frozen)'), raw: 1.1 },
  pumpkin: { dept: 'produce', name: tr('pumpkin'), raw: 1.3 },
  beets: { dept: 'produce', name: tr('Beets (fresh or vacuum-packed cooked)'), raw: 1.2 },

  banana: { dept: 'produce', name: tr('Bananas'), count: { g: 120, u: raw('{0, plural, =0.25 {{1} Banana} =0.5 {{1} Banana} =0.75 {{1} Banana} one {{1} Banana} other {{1} Bananas}}') } },
  apple: { dept: 'produce', name: tr('Apples'), count: { g: 180, u: raw('{0, plural, =0.25 {{1} apple} =0.5 {{1} apple} =0.75 {{1} apple} one {{1} apple} other {{1} apples}}') } },
  berries: { dept: 'produce', name: tr('Frozen mixed berries'), pack: pk(800, tr('800 g bag')) },
  orange: { dept: 'produce', name: tr('Oranges'), count: { g: 160, u: raw('{0, plural, =0.25 {{1} Orange} =0.5 {{1} Orange} =0.75 {{1} Orange} one {{1} Orange} other {{1} Oranges}}') } },
  dates: { dept: 'produce', name: tr('Medjool dates'), pack: pk(500, tr('500 g box')) },
  grapes: { dept: 'produce', name: tr('Grapes'), raw: 1.05 },
  pear: { dept: 'produce', name: tr('Pears'), count: { g: 170, u: raw('{0, plural, =0.25 {{1} Pear} =0.5 {{1} Pear} =0.75 {{1} Pear} one {{1} Pear} other {{1} Pears}}') } },
  kiwi: { dept: 'produce', name: tr('Kiwi'), count: { g: 75, u: raw('{0, plural, =0.25 {{1} Kiwi} =0.5 {{1} Kiwi} =0.75 {{1} Kiwi} one {{1} Kiwi} other {{1} kiwis}}') } },
  mango: { dept: 'produce', name: tr('Mango'), count: { g: 330, u: raw('{0, plural, =0.25 {{1} Mango} =0.5 {{1} Mango} =0.75 {{1} Mango} one {{1} Mango} other {{1} Mango}}') } },
  watermelon: { dept: 'produce', name: tr('Watermelon'), raw: 1.6, note: tr('Or half a watermelon / cut watermelon') },
  melon: { dept: 'produce', name: tr('Melon'), raw: 1.5 },
  peach: { dept: 'produce', name: tr('Peaches / nectarines'), count: { g: 150, u: raw('{0, plural, =0.25 {{1} Peach} =0.5 {{1} Peach} =0.75 {{1} Peach} one {{1} Peach} other {{1} peaches}}') } },
  pineapple: { dept: 'produce', name: tr('Pineapple (fresh or cut, canned)'), raw: 1.8 },
  plums: { dept: 'produce', name: tr('Plums'), count: { g: 65, u: raw('{0, plural, =0.25 {{1} plum} =0.5 {{1} plum} =0.75 {{1} plum} one {{1} plum} other {{1} Plums}}') } },
  pomegranate: { dept: 'produce', name: tr('Pomegranates (or packaged pomegranate seeds)'), count: { g: 170, u: raw('{0, plural, =0.25 {{1} pomegranate} =0.5 {{1} pomegranate} =0.75 {{1} pomegranate} one {{1} pomegranate} other {{1} pomegranates}}') } },
  clementine: { dept: 'produce', name: tr('Clementines'), count: { g: 75, u: raw('{0, plural, =0.25 {{1} clementine} =0.5 {{1} clementine} =0.75 {{1} clementine} one {{1} clementine} other {{1} Clementines}}') } },
  strawberries: { dept: 'produce', name: tr('Strawberries'), pack: pk(250, tr('250 g container')) },
  persimmon: { dept: 'produce', name: tr('Persimmons'), count: { g: 170, u: raw('{0, plural, =0.25 {{1} Persimmon} =0.5 {{1} Persimmon} =0.75 {{1} Persimmon} one {{1} Persimmon} other {{1} Persimmons}}') } },
  figs: { dept: 'produce', name: tr('Fresh figs'), count: { g: 50, u: raw('{0, plural, =0.25 {{1} fig} =0.5 {{1} fig} =0.75 {{1} fig} one {{1} fig} other {{1} figs}}') } },
  apricot: { dept: 'produce', name: tr('apricots'), count: { g: 35, u: raw('{0, plural, =0.25 {{1} Apricot} =0.5 {{1} Apricot} =0.75 {{1} Apricot} one {{1} Apricot} other {{1} apricots}}') } },
  cherries: { dept: 'produce', name: tr('Cherries (fresh or frozen)'), raw: 1.1 },
  nectarine: { dept: 'produce', name: tr('Nectarines'), count: { g: 140, u: raw('{0, plural, =0.25 {{1} Nectarine} =0.5 {{1} Nectarine} =0.75 {{1} Nectarine} one {{1} Nectarine} other {{1} Nectarines}}') } },
  grapefruit: { dept: 'produce', name: tr('Grapefruits'), count: { g: 250, u: raw('{0, plural, =0.25 {{1} Grapefruit} =0.5 {{1} Grapefruit} =0.75 {{1} Grapefruit} one {{1} Grapefruit} other {{1} Grapefruits}}') } },
  pomelo: { dept: 'produce', name: tr('Pomelo'), raw: 1.6, note: tr('One pomelo weighs about 1.5 kg and lasts several days') },
  lychee: { dept: 'produce', name: tr('Lychee'), raw: 1.4 },
  passion_fruit: { dept: 'produce', name: tr('Passion fruits'), count: { g: 18, u: raw('{0, plural, =0.25 {{1} Passion fruit} =0.5 {{1} Passion fruit} =0.75 {{1} Passion fruit} one {{1} Passion fruit} other {{1} Passion fruits}}') } },
  guava: { dept: 'produce', name: tr('guavas'), count: { g: 55, u: raw('{0, plural, =0.25 {{1} Guava} =0.5 {{1} Guava} =0.75 {{1} Guava} one {{1} Guava} other {{1} guavas}}') } },
  papaya: { dept: 'produce', name: tr('Papaya'), raw: 1.4 },
  blueberries: { dept: 'produce', name: tr('Blueberries (fresh or frozen)'), pack: pk(125, tr('125 g container')) },
  raspberries: { dept: 'produce', name: tr('Raspberries (fresh or frozen)'), pack: pk(125, tr('125 g container')) },
  loquat: { dept: 'produce', name: tr('Loquat'), count: { g: 20, u: raw('{0, plural, =0.25 {{1} Loquat} =0.5 {{1} Loquat} =0.75 {{1} Loquat} one {{1} Loquat} other {{1} loquats}}') } },
  raisins: { dept: 'dry', name: tr('Raisins'), pack: pk(250, tr('250 g bag')), staple: true },
  dried_apricots: { dept: 'dry', name: tr('Dried apricot'), pack: pk(200, tr('200 g bag')) },
  prunes: { dept: 'dry', name: tr('Prunes'), pack: pk(250, tr('250 g bag')) },
};

export function fmtWeight(g) {
  if (g >= 1000) {
    const kg = Math.ceil(g / 100) / 10;
    return tr('{0} kg', kg.toLocaleString(locale, { maximumFractionDigits: 1 }));
  }
  const step = g > 200 ? 50 : g > 50 ? 10 : 5;
  return tr('{0} g', Math.max(step, Math.ceil(g / step) * step));
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
      line.qty = format(info.count.u, [pieces, pieces]);
      if (info.pack && pieces * info.count.g > info.pack.g * 0.6) {
        const packs = Math.ceil((pieces * info.count.g) / info.pack.g);
        line.qty += ` (${packs} × ${info.pack.label})`;
      }
    } else if (info.pack) {
      const packs = Math.max(1, Math.ceil(line.need / info.pack.g - 0.1));
      line.qty = `${packs} × ${info.pack.label}`;
      line.detail = tr('Need {0}', fmtWeight(line.need));
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
