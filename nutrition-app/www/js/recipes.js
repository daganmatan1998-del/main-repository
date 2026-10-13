// Recipe engine. Builds recipes for a meal out of the meal's own ingredients
// (with exactly the planned amounts) and their substitutes, combined with a
// cooking method that suits each food and a flavour profile. Spices, herbs,
// lemon and garlic are the only extras — they add no meaningful calories.
//
// A typical meal yields hundreds to thousands of distinct recipes, all offline.
// Pure module: no DOM, unit-tested directly.

import { t as tr, trl, locale, capitalNouns } from './i18n.js';
import { FOOD_BY_ID, household, isAllowed } from './foods.js';
import { SHOP } from './shopping.js';
import { alternatives } from './substitutions.js';
import { rng, hashStr } from './util.js';

// ---------- short names used inside recipe titles ----------
const NAME = {
  chicken_breast: tr('chicken breast'), turkey_breast: tr('turkey breast‖short'), chicken_thigh: tr('chicken thighs'), lean_beef: tr('ground meat'),
  beef_20: tr('ground meat'), entrecote: tr('entrecote'), salmon: tr('salmon'), white_fish: tr('white fish fillet'), tuna: tr('tuna'),
  sardines: tr('sardines'), shrimp: tr('shrimp'), eggs: tr('eggs‖short'), egg_whites: tr('egg whites'), cottage: tr('cottage cheese‖name'),
  white_cheese: tr('white cheese'), labane: tr('labneh'), greek_yogurt: tr('yogurt'), yellow_cheese: tr('yellow cheese'),
  whey: tr('protein powder'), pea_protein: tr('plant protein powder‖short'), tofu: tr('tofu'), tempeh: tr('tempeh‖short'), seitan: tr('seitan‖short'),
  lentils: tr('lentils'), chickpeas: tr('hummus'), black_beans: tr('black beans'), edamame: tr('edamame'), turkey_pastrami: tr('pastrami'),
  white_rice: tr('rice'), brown_rice: tr('brown rice'), quinoa: tr('quinoa'), pasta: tr('pasta'), sweet_potato: tr('sweet potato'),
  potato: tr('potatoes'), buckwheat: tr('buckwheat'), bulgur: tr('bulgur'), couscous: tr('couscous'), freekeh: tr('freekeh‖name'),
  wholewheat_bread: tr('whole wheat bread‖short'), rye_bread: tr('rye bread‖short'), gf_bread: tr('gluten-free bread‖short'), pita: tr('pita'),
  tortilla: tr('tortilla'), oats: tr('oats‖short'), rice_cakes: tr('rice cakes‖short'), corn: tr('corn'),
  banana: tr('banana‖short'), apple: tr('apple'), berries: tr('berries‖short'), orange: tr('orange‖short'), dates: tr('dates'), grapes: tr('grapes‖short'), pear: tr('pear‖short'), kiwi: tr('kiwi‖short'),
  ground_chicken: tr('ground chicken'), ground_turkey: tr('ground turkey'), sirloin: tr('sirloin'), trout: tr('trout'), hake: tr('hake'),
  bulgarian: tr('Bulgarian cheese'), skyr: tr('skyr'), pro_pudding: tr('protein dessert'), soy_chunks: tr('soy granules'), white_beans: tr('white beans'),
  barley: tr('barley groats'), millet: tr('millet'), ptitim: tr('ptitim'), whole_pasta: tr('whole wheat pasta'), gf_pasta: tr('gluten-free pasta'),
  rice_noodles: tr('rice noodles'), green_peas: tr('peas'), whole_bun: tr('whole wheat bun'), crispbread: tr('crispbread'),
  mango: tr('mango‖short'), watermelon: tr('watermelon‖short'), melon: tr('melon‖short'), peach: tr('peach‖short'), pineapple: tr('pineapple‖short'), plums: tr('plums‖short'),
  pomegranate: tr('pomegranate seeds‖short'), clementine: tr('clementines‖short'), strawberries: tr('strawberries‖short'),
  persimmon: tr('persimmon‖short'), figs: tr('figs'), apricot: tr('apricots'), cherries: tr('cherries‖short'), nectarine: tr('nectarine‖short'),
  grapefruit: tr('grapefruit‖short'), pomelo: tr('pomelo‖short'), lychee: tr('lychee‖short'), passion_fruit: tr('passion fruit‖short'), guava: tr('guava‖short'),
  papaya: tr('papaya‖short'), blueberries: tr('blueberries‖short'), raspberries: tr('raspberries‖short'), loquat: tr('loquat‖short'), raisins: tr('raisins‖short'),
  dried_apricots: tr('dried apricot‖short'), prunes: tr('prunes‖short'),
};
// Titles and steps are built from lowercase names: start each with a capital (no effect in Hebrew).
// Foods without a short name keep their full name, in lowercase inside a sentence (not in languages that capitalise nouns).
const lowerFirst = (s) => (capitalNouns ? s : s.charAt(0).toLocaleLowerCase(locale) + s.slice(1));
const upperFirst = (s) => (s ? s.charAt(0).toLocaleUpperCase(locale) + s.slice(1) : s);
// "150 g chicken breast", "2 slices pastrami": the language decides whether a word joins them ("150 g de pollo").
const amountOf = (amount, food) => tr('{0} {1}‖amount of food', amount, food);
const nm = (id) => NAME[id] || lowerFirst(FOOD_BY_ID[id].name);

// Definite forms ("the chicken"). Hebrew puts the article on the second word
// of a construct (חזה העוף) and on both words of noun + adjective (הגבינה
// הלבנה), so these are spelled out rather than built with a prefix.
const DEF = {
  chicken_breast: tr('the chicken breast'), turkey_breast: tr('the turkey breast'), chicken_thigh: tr('the chicken thighs'), lean_beef: tr('the ground beef'),
  beef_20: tr('the ground beef'), entrecote: tr('the entrecote'), salmon: tr('the salmon'), white_fish: tr('the fish'), tuna: tr('the tuna'),
  sardines: tr('the sardines'), shrimp: tr('the shrimp'), eggs: tr('the eggs'), egg_whites: tr('the egg whites'), cottage: tr('the cottage cheese'),
  white_cheese: tr('the white cheese'), labane: tr('the labneh'), greek_yogurt: tr('the yogurt'), yellow_cheese: tr('the yellow cheese'),
  whey: tr('the protein powder'), pea_protein: tr('the protein powder'), tofu: tr('the tofu'), tempeh: tr('the tempeh'), seitan: tr('the seitan'),
  lentils: tr('the lentils'), chickpeas: tr('the chickpeas'), black_beans: tr('the beans'), edamame: tr('the edamame'), turkey_pastrami: tr('the turkey pastrami'),
  white_rice: tr('the rice'), brown_rice: tr('the rice'), quinoa: tr('the quinoa'), pasta: tr('the pasta'), sweet_potato: tr('the sweet potato'),
  potato: tr('the potatoes'), buckwheat: tr('the buckwheat'), bulgur: tr('the bulgur'), couscous: tr('the couscous'), freekeh: tr('the freekeh'),
  wholewheat_bread: tr('the bread'), rye_bread: tr('the bread'), gf_bread: tr('the bread'), pita: tr('the pita'), tortilla: tr('the tortilla'),
  oats: tr('the oats'), rice_cakes: tr('the rice cakes'), corn: tr('the corn'), banana: tr('the banana'), apple: tr('the apple'),
  berries: tr('the berries'), orange: tr('the orange'), dates: tr('the dates'), grapes: tr('the grapes'), pear: tr('the pear'), kiwi: tr('the kiwi'),
  ground_chicken: tr('the ground chicken'), ground_turkey: tr('the ground turkey'), sirloin: tr('the sirloin'), trout: tr('the trout'), hake: tr('the hake'),
  bulgarian: tr('the Bulgarian cheese'), skyr: tr('the skyr'), pro_pudding: tr('the protein dessert'), soy_chunks: tr('the soy granules'), white_beans: tr('the beans'),
  barley: tr('the barley'), millet: tr('the millet'), ptitim: tr('the ptitim'), whole_pasta: tr('the pasta'), gf_pasta: tr('the pasta'),
  rice_noodles: tr('the rice noodles'), green_peas: tr('the peas'), whole_bun: tr('the bun'), crispbread: tr('the crispbread'),
  mango: tr('the mango'), watermelon: tr('the watermelon'), melon: tr('the melon'), peach: tr('the peach'), pineapple: tr('the pineapple'), plums: tr('the plums'),
  pomegranate: tr('the pomegranate seeds'), clementine: tr('the clementines'), strawberries: tr('the strawberries'),
  persimmon: tr('the persimmon'), figs: tr('the figs'), apricot: tr('the apricots'), cherries: tr('the cherries'), nectarine: tr('the nectarine'),
  grapefruit: tr('the grapefruit'), pomelo: tr('the pomelo'), lychee: tr('the lychee'), passion_fruit: tr('the passion fruit'), guava: tr('the guava'),
  papaya: tr('the papaya'), blueberries: tr('the blueberries'), raspberries: tr('the raspberries'), loquat: tr('the loquat'), raisins: tr('the raisins'),
  dried_apricots: tr('the dried apricots'), prunes: tr('the prunes'),
};
const def = (id) => DEF[id] || tr('the {0}', nm(id));
// Foods whose household unit already names the food ("2 ביצים").
const SELF_UNIT = new Set(['eggs', 'egg_whites']);

const SERVE_WARM = tr('Serve warm');
const SERVE_COLD = tr('Serve cold');

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
  ground_chicken: 'ground', ground_turkey: 'ground', soy_chunks: 'ground', sirloin: 'steak', trout: 'fish', hake: 'fish',
  bulgarian: 'saltycheese', skyr: 'yogurt', pro_pudding: 'yogurt', white_beans: 'legume',
  barley: 'grain', millet: 'grain', ptitim: 'grain', whole_pasta: 'pasta', gf_pasta: 'pasta', rice_noodles: 'pasta',
  green_peas: 'corn', whole_bun: 'bread', crispbread: 'crackers',
  mango: 'fruit', watermelon: 'fruit', melon: 'fruit', peach: 'fruit', pineapple: 'fruit', plums: 'fruit',
  pomegranate: 'fruit', clementine: 'fruit', strawberries: 'fruit',
  persimmon: 'fruit', figs: 'fruit', apricot: 'fruit', cherries: 'fruit', nectarine: 'fruit', grapefruit: 'fruit',
  pomelo: 'fruit', lychee: 'fruit', passion_fruit: 'fruit', guava: 'fruit', papaya: 'fruit', blueberries: 'fruit',
  raspberries: 'fruit', loquat: 'fruit', raisins: 'fruit', dried_apricots: 'fruit', prunes: 'fruit',
};
// Carb kinds that can carry a dish on their own (a meal without protein).
const CARB_KINDS = ['grain', 'pasta', 'tuber', 'corn', 'oats', 'bread', 'pita', 'tortilla', 'crackers', 'fruit'];
const COOKED_CARBS = ['grain', 'pasta', 'tuber', 'corn'];

// ---------- flavour profiles ----------
// rub: how the main ingredient is seasoned; finish: the last touch.
// pantry: what the user needs at home (salt & pepper are assumed).
export const FLAVORS = [
  { id: 'lemon_garlic', label: tr('Lemon and garlic'), phrase: tr('in lemon-garlic sauce'), cuisine: 'med', taste: 'savory', rub: tr('crushed garlic, lemon zest, salt and pepper'), finish: tr('Squeeze half a lemon over the top'), pantry: [...trl('garlic'), ...trl('lemon')] },
  { id: 'moroccan', label: tr('Moroccan'), phrase: tr('with Moroccan seasoning'), cuisine: 'mizrahi', taste: 'savory', rub: tr('sweet paprika, cumin, crushed garlic and salt'), finish: tr('Sprinkle with chopped cilantro'), pantry: [tr('paprika'), tr('cumin'), ...trl('garlic'), tr('cilantro')] },
  { id: 'shawarma', label: tr('Shawarma'), phrase: tr('with shawarma seasoning'), cuisine: 'mizrahi', taste: 'savory', rub: tr('shawarma spice mix (or turmeric, cumin and paprika), salt and pepper'), finish: tr('Add red onion rings'), pantry: [tr('shawarma spice mix'), ...trl('onion')] },
  { id: 'zaatar', label: tr('Za\'atar and lemon'), phrase: tr('with za\'atar and lemon'), cuisine: 'mizrahi', taste: 'savory', rub: tr('za\'atar, a little lemon and salt'), finish: tr('Sprinkle with a little more za\'atar'), pantry: [tr('za\'atar'), ...trl('lemon')] },
  { id: 'hawaij', label: tr('Yemenite hawaij'), phrase: tr('with Yemenite hawaij'), cuisine: 'mizrahi', taste: 'savory', rub: tr('hawaij for soup, turmeric and salt'), finish: tr('Sprinkle with parsley'), pantry: [tr('hawaij'), tr('parsley')] },
  { id: 'harissa', label: tr('Spicy harissa'), phrase: tr('in spicy harissa'), cuisine: 'mizrahi', taste: 'savory', spicy: true, rub: tr('a teaspoon of harissa, garlic and salt'), finish: tr('Sprinkle with cilantro'), pantry: [tr('harissa'), ...trl('garlic'), tr('cilantro')] },
  { id: 'tomato', label: tr('Spicy tomato sauce'), phrase: tr('in spicy tomato sauce'), cuisine: 'mizrahi', taste: 'savory', sauce: true, rub: tr('paprika, cumin and garlic'), finish: tr('Sprinkle with parsley'), pantry: [tr('crushed tomatoes'), tr('paprika'), tr('cumin'), ...trl('garlic')] },
  { id: 'greek', label: tr('Greek'), phrase: tr('Greek-style'), cuisine: 'med', taste: 'savory', rub: tr('oregano, garlic, lemon and salt'), finish: tr('Squeeze lemon over the top and sprinkle with oregano'), pantry: [tr('oregano'), ...trl('lemon'), ...trl('garlic')] },
  { id: 'italian', label: tr('Italian'), phrase: tr('Italian-style'), cuisine: 'italian', taste: 'savory', rub: tr('basil, oregano, garlic and salt'), finish: tr('Scatter fresh basil leaves over the top'), pantry: [tr('basil'), tr('oregano'), ...trl('garlic')] },
  { id: 'pizzaiola', label: tr('Pizzaiola'), phrase: tr('in pizzaiola sauce'), cuisine: 'italian', taste: 'savory', sauce: true, rub: tr('garlic, oregano and salt'), finish: tr('Sprinkle with basil'), pantry: [tr('crushed tomatoes'), tr('oregano'), ...trl('garlic')] },
  { id: 'herbs', label: tr('Herbs'), phrase: tr('with herbs'), cuisine: 'med', taste: 'savory', rub: tr('parsley, dill, garlic and salt'), finish: tr('Sprinkle with more fresh herbs'), pantry: [tr('parsley'), tr('dill'), ...trl('garlic')] },
  { id: 'mustard', label: tr('Mustard and thyme'), phrase: tr('with mustard and thyme'), cuisine: 'euro', taste: 'savory', rub: tr('a teaspoon of Dijon mustard, thyme and salt'), finish: tr('Sprinkle with fresh thyme'), pantry: [tr('Mustard'), tr('thyme')] },
  { id: 'bbq', label: tr('Smoky barbecue'), phrase: tr('with smoky barbecue seasoning'), cuisine: 'american', taste: 'savory', rub: tr('smoked paprika, garlic granules, a little mustard and salt'), finish: tr('Sprinkle with green onion'), pantry: [tr('smoked paprika'), ...trl('garlic'), tr('Mustard')] },
  { id: 'mexican', label: tr('Mexican'), phrase: tr('Mexican-style'), cuisine: 'mexican', taste: 'savory', spicy: true, rub: tr('cumin, smoked paprika, chili and salt'), finish: tr('Squeeze lime over the top and sprinkle with cilantro'), pantry: [tr('cumin'), tr('smoked paprika'), tr('chili'), tr('lime'), tr('cilantro')] },
  { id: 'asian', label: tr('Asian'), phrase: tr('Asian-style'), cuisine: 'asian', taste: 'savory', allergens: ['soy', 'gluten'], rub: tr('a tablespoon of soy sauce, grated ginger and garlic'), finish: tr('Sprinkle with green onion and sesame seeds (if not allergic)'), pantry: [tr('Soy sauce'), tr('ginger'), ...trl('garlic')] },
  { id: 'thai', label: tr('Thai'), phrase: tr('Thai-style'), cuisine: 'asian', taste: 'savory', spicy: true, rub: tr('ginger, garlic, chili and lime zest'), finish: tr('Squeeze lime over the top and sprinkle with cilantro'), pantry: [tr('ginger'), ...trl('garlic'), tr('chili'), tr('lime'), tr('cilantro')] },
  { id: 'curry', label: tr('Indian curry'), phrase: tr('in Indian curry'), cuisine: 'indian', taste: 'savory', rub: tr('curry powder, turmeric, ginger and garlic'), finish: tr('Sprinkle with cilantro'), pantry: [tr('curry powder'), tr('turmeric'), tr('ginger'), ...trl('garlic')] },
  { id: 'tandoori', label: tr('Tandoori'), phrase: tr('with tandoori seasoning'), cuisine: 'indian', taste: 'savory', rub: tr('paprika, cumin, garam masala and garlic'), finish: tr('Squeeze lemon over the top'), pantry: [tr('paprika'), tr('cumin'), tr('garam masala'), ...trl('garlic'), ...trl('lemon')] },
  { id: 'cinnamon', label: tr('Cinnamon'), phrase: tr('with cinnamon'), cuisine: 'sweet', taste: 'sweet', rub: tr('cinnamon and sweetener to taste'), finish: tr('Sprinkle with a little more cinnamon'), pantry: [tr('Cinnamon')] },
  { id: 'vanilla', label: tr('Vanilla'), phrase: tr('with vanilla'), cuisine: 'sweet', taste: 'sweet', rub: tr('a few drops of vanilla extract and sweetener to taste'), finish: tr('Serve cold'), pantry: [tr('vanilla extract')] },
  { id: 'cocoa', label: tr('Cocoa‖label'), phrase: tr('with cocoa'), cuisine: 'sweet', taste: 'sweet', rub: tr('a teaspoon of cocoa powder and sweetener to taste'), finish: tr('Sprinkle a little cocoa over the top'), pantry: [tr('cocoa powder')] },
  { id: 'cardamom', label: tr('Cardamom and cinnamon'), phrase: tr('with cardamom and cinnamon'), cuisine: 'sweet', taste: 'sweet', rub: tr('ground cardamom, cinnamon and sweetener'), finish: tr('Serve warm'), pantry: [tr('cardamom'), tr('Cinnamon')] },
  { id: 'coffee', label: tr('Coffee‖label'), phrase: tr('with coffee'), cuisine: 'sweet', taste: 'sweet', rub: tr('a teaspoon of instant coffee dissolved in a tablespoon of hot water and sweetener to taste'), finish: tr('Serve cold'), pantry: [...trl('instant coffee')] },
  { id: 'coconut', label: tr('Coconut'), phrase: tr('with coconut'), cuisine: 'sweet', taste: 'sweet', rub: tr('a few drops of coconut extract and sweetener to taste'), finish: tr('Serve cold'), pantry: [tr('coconut extract')] },
  { id: 'gingerbread', label: tr('Gingerbread'), phrase: tr('with gingerbread spices'), cuisine: 'sweet', taste: 'sweet', rub: tr('ground ginger, cinnamon, a pinch of cloves and sweetener'), finish: tr('Sprinkle with a pinch of cinnamon'), pantry: [tr('ground ginger'), tr('Cinnamon'), tr('cloves')] },
  { id: 'orange_blossom', label: tr('Orange blossom water'), phrase: tr('with orange blossom water'), cuisine: 'sweet', taste: 'sweet', rub: tr('a teaspoon of orange blossom water and sweetener to taste'), finish: tr('Serve cold'), pantry: [tr('Orange blossom water')] },
  { id: 'mint', label: tr('Mint'), phrase: tr('with fresh mint'), cuisine: 'sweet', taste: 'sweet', rub: tr('a few chopped mint leaves and sweetener to taste'), finish: tr('Garnish with a mint leaf'), pantry: [tr('Mint')] },
  { id: 'lemon_zest', label: tr('Lemon zest'), phrase: tr('with lemon zest'), cuisine: 'sweet', taste: 'sweet', rub: tr('lemon zest and sweetener to taste'), finish: tr('Grate a little more zest over the top'), pantry: [...trl('lemon')] },
];

// Pantry items are listed in lowercase, whatever the translation's casing.
for (const f of FLAVORS) f.pantry = f.pantry.map(lowerFirst);

export const CUISINES = [
  { id: 'mizrahi', label: tr('Middle Eastern / Israeli') },
  { id: 'med', label: tr('Mediterranean') },
  { id: 'italian', label: tr('Italian') },
  { id: 'asian', label: tr('Asian') },
  { id: 'mexican', label: tr('Mexican') },
  { id: 'indian', label: tr('Indian') },
  { id: 'american', label: tr('Barbecue‖label') },
  { id: 'euro', label: tr('European') },
  { id: 'sweet', label: tr('Sweet') },
];

export const TOOLS = [
  { id: 'pan', label: tr('Frying pan') },
  { id: 'oven', label: tr('Oven') },
  { id: 'pot', label: tr('Pot') },
  { id: 'airfryer', label: tr('Air fryer') },
  { id: 'grill', label: tr('Grill / grill pan') },
  { id: 'blender', label: tr('Blender') },
  { id: 'nocook', label: tr('No cooking') },
];

export const PANTRY = [...new Set(FLAVORS.flatMap((f) => f.pantry).concat([...trl('onion'), tr('crushed tomatoes'), ...trl('vinegar'), tr('parsley')]))].sort((a, b) => a.localeCompare(b, locale));

// ---------- how each side is used ----------
function carbPrep(id, grams, inOven) {
  const k = KIND[id];
  const info = SHOP[id] || {};
  const dry = info.raw && info.raw < 1 ? Math.round(grams * info.raw / 5) * 5 : null;
  const n = nm(id);
  if (k === 'grain') return tr('Cook about {0} g of dry {1} according to the package directions (yields {2} g cooked)', dry, n, grams);
  if (id === 'rice_noodles') return tr('Soak or cook about {0} g of dry rice noodles according to the package directions, then drain', dry);
  if (k === 'pasta') return tr('Cook about {0} g of dry {1} in boiling salted water according to the package directions, then drain', dry, n);
  if (k === 'tuber') return inOven ? tr('Cut {0} g of {1} into wedges and bake on the same tray for about 25 minutes', grams, n) : tr('Cut {0} g of {1} into cubes and boil in salted water for about 15 minutes', grams, n);
  if (id === 'green_peas') return tr('Heat {0} g of green peas (frozen) for 3–4 minutes', grams);
  if (k === 'corn') return tr('Drain {0} g of corn', grams);
  if (k === 'oats') return tr('Cook {0} g of oats with a cup of water for about 3 minutes, until thick', grams);
  if (k === 'crackers') return (id === 'rice_cakes' ? tr('Serve alongside {0}‖rice cakes', household(FOOD_BY_ID[id], grams)) : tr('Serve alongside {0}', household(FOOD_BY_ID[id], grams)));
  if (id === 'whole_bun') return tr('Split and toast the whole wheat bun ({0})', household(FOOD_BY_ID[id], grams));
  if (k === 'bread') return tr('Toast {0} of {1}', household(FOOD_BY_ID[id], grams), n);
  if (k === 'pita') return tr('Warm {0} in a dry pan or in a toaster', household(FOOD_BY_ID[id], grams));
  if (k === 'tortilla') return tr('Warm {0} in a dry pan for 20 seconds on each side', household(FOOD_BY_ID[id], grams));
  if (k === 'fruit') {
    // Berries and grapes are washed, citrus and lychee peeled, dried fruit
    // added as is; the rest is cut.
    if (['berries', 'blueberries', 'raspberries', 'grapes', 'cherries', 'strawberries'].includes(id)) return tr('Rinse {0} g of {1}', grams, n);
    if (['orange', 'clementine', 'grapefruit', 'pomelo', 'lychee'].includes(id)) return tr('Peel {0} g of {1}', grams, n);
    if (id === 'passion_fruit') return tr('Halve {0} and scoop out the pulp with a spoon', household(FOOD_BY_ID[id], grams));
    if (id === 'pomegranate') return tr('Separate {0} g of pomegranate seeds', grams);
    if (['raisins', 'dried_apricots', 'prunes', 'dates'].includes(id)) return tr('Add {0} g of {1}', grams, n);
    return tr('Cut {0} g of {1}', grams, n);
  }
  return null;
}

function vegPrep(id, grams, inOven) {
  if (!id) return null;
  if (id === 'salad') return tr('Chop a salad of tomato, cucumber and pepper ({0} g in total)', grams);
  if (id === 'leafy') return tr('Lay down a bed of {0} g of leafy greens', grams);
  if (id === 'carrot') return tr('Peel {0} g of carrots and cut into sticks', grams);
  if (id === 'spinach') return tr('Steam {0} g of spinach for 2–3 minutes, until wilted', grams);
  if (id === 'mushrooms') return tr('Slice {0} g of mushrooms and sauté for 5 minutes in a pan', grams);
  if (id === 'cucumber') return tr('Cut {0} g of cucumber into slices or sticks', grams);
  if (id === 'tomato') return tr('Slice {0} g of tomatoes', grams);
  if (id === 'peppers') return tr('Cut {0} g of colorful peppers into strips', grams);
  if (id === 'cabbage') return tr('Finely shred {0} g of cabbage and dress with lemon and salt', grams);
  if (id === 'beets') return tr('Cut {0} g of cooked beets into cubes', grams);
  if (id === 'eggplant') return inOven ? tr('Halve an eggplant ({0} g) and bake it on the same tray until soft', grams) : tr('Char an eggplant ({0} g) over the flame or in the oven, then chop the flesh', grams);
  const name = { broccoli: tr('broccoli'), green_beans: tr('green beans'), cauliflower: tr('cauliflower'), roasted_veg: tr('zucchini, pepper and onion'), zucchini: tr('Zucchini'), asparagus: tr('asparagus'), brussels: tr('brussels sprouts'), pumpkin: tr('pumpkin') }[id] || FOOD_BY_ID[id].name;
  return inOven ? tr('Place {0} g of {1} on the tray and bake together', grams, name) : tr('Steam or sauté {0} g of {1} for 6–8 minutes', grams, name);
}

function fatUse(id, grams, cooking) {
  if (!id) return null;
  const f = FOOD_BY_ID[id];
  const hh = household(f, grams);
  if (id === 'olive_oil') return cooking ? tr('Grease lightly with a little of the {0} of olive oil and drizzle the rest over the dish when serving', hh) : tr('Drizzle {0} of olive oil over the top', hh);
  if (id === 'canola_oil') return cooking ? tr('Grease the pan or tray with a little of the {0} of canola oil and add the rest while cooking', hh) : tr('Drizzle {0} of canola oil over the top', hh);
  if (id === 'butter') return cooking ? tr('Melt {0} of butter in the pan', hh) : tr('Spread {0} of butter', hh);
  if (id === 'ghee') return cooking ? tr('Melt {0} of ghee in the pan', hh) : tr('Drizzle {0} of melted ghee over the top', hh);
  if (id === 'almond_butter') return tr('Add {0} of almond butter', hh);
  if (id === 'hummus_spread') return tr('Serve alongside {0} of hummus spread', hh);
  if (id === 'cream_cheese') return tr('Spread or mix in {0} of cream cheese', hh);
  if (id === 'feta') return tr('Crumble {0} g of feta cheese over the top', grams);
  if (id === 'mozzarella') return cooking ? tr('Top with {0} g of torn mozzarella and let it melt', grams) : tr('Tear {0} g of mozzarella and add it', grams);
  if (id === 'tahini') return tr('Mix {0} of raw tahini with water and a little lemon into a sauce, and drizzle over the top', hh);
  if (id === 'peanut_butter') return tr('Add {0} of peanut butter', hh);
  if (id === 'avocado') return tr('Slice or mash {0} and set aside', hh);
  if (id === 'olives') return tr('Add {0}', hh);
  if (id === 'hard_cheese') return tr('Grate {0} g of hard cheese over the top', grams);
  if (['chia', 'flaxseed', 'sesame_seeds'].includes(id)) return tr('Mix in {0} of {1}', hh, nm(id));
  return tr('Lightly toast {0} g of {1} and sprinkle over the top', grams, nm(id));
}

// ---------- cooking methods ----------
// kinds: which protein kinds; carbs: required carb kinds (null = any or none);
// absorbs: the carb is part of the dish (not a side).
const T = (o) => ({ meals: 'blds', carbs: null, absorbs: false, taste: 'savory', ...o });
const METHODS = [
  // poultry & steak
  T({ id: 'oven', kinds: ['poultry', 'steak', 'fish', 'tofu'], meals: 'ld', tool: 'oven', time: 35, cooking: true, oven: true,
    title: (c) => tr('{0} in the oven {1}', c.P, c.flavor.phrase),
    steps: (c) => [tr('Preheat the oven to 200°C'), tr('Season {0} with {1}', c.amtP, c.flavor.rub), c.fatStep, tr('Bake for about {0} minutes, until done', c.kind === 'fish' ? 15 : c.kind === 'tofu' ? 25 : 22)] }),
  T({ id: 'pan', kinds: ['poultry', 'steak', 'fish', 'tofu', 'shrimp'], meals: 'ld', tool: 'pan', time: 20, cooking: true,
    title: (c) => tr('{0} in a pan {1}', c.P, c.flavor.phrase),
    steps: (c) => [(c.kind === 'poultry' ? tr('Slice {0} into thin steaks and season with {1}', c.amtP, c.flavor.rub) : tr('Pat {0} dry and season with {1}', c.amtP, c.flavor.rub)), c.fatStep, tr('Sear in a hot pan for {0} minutes on each side', c.kind === 'steak' ? '3–4' : c.kind === 'shrimp' ? '2' : '4–5'), tr('Let rest for a minute')] }),
  T({ id: 'airfryer', kinds: ['poultry', 'fish', 'tofu', 'shrimp'], meals: 'ld', tool: 'airfryer', time: 20, cooking: true,
    title: (c) => tr('{0} in the air fryer {1}', c.P, c.flavor.phrase),
    steps: (c) => [tr('Season {0} with {1}', c.amtP, c.flavor.rub), c.fatStep, tr('Place in the air fryer at 190°C for {0} minutes, turning halfway', c.kind === 'fish' || c.kind === 'shrimp' ? '10' : '15–18')] }),
  T({ id: 'grill', kinds: ['poultry', 'steak', 'fish', 'tofu'], meals: 'ld', tool: 'grill', time: 25, cooking: true,
    title: (c) => tr('{0} on the grill pan {1}', c.P, c.flavor.phrase),
    steps: (c) => [tr('Marinate {0} in {1} for at least 10 minutes', c.amtP, c.flavor.rub), c.fatStep, tr('Grill in a hot grill pan for {0} minutes on each side', c.kind === 'fish' ? '3' : '5')] }),
  T({ id: 'skewers', kinds: ['poultry', 'steak', 'tofu', 'shrimp'], meals: 'ld', tool: 'oven', time: 30, cooking: true, oven: true,
    title: (c) => tr('{0} skewers {1}', c.P, c.flavor.phrase),
    steps: (c) => [tr('Cut {0} into cubes and thread onto skewers', c.amtP), tr('Season with {0}', c.flavor.rub), c.fatStep, tr('Broil in the oven for 12–15 minutes, turning once')] }),
  T({ id: 'stirfry', kinds: ['poultry', 'steak', 'tofu', 'shrimp', 'legume'], meals: 'ld', tool: 'pan', time: 15, cooking: true,
    title: (c) => `${c.kind === 'legume' ? tr('Stir-fried {0}', c.P) : tr('Stir-fried {0} strips', c.P)} ${c.flavor.phrase}${c.absorbedCarb}`, absorbsIf: ['grain', 'pasta'],
    steps: (c) => [tr('Slice {0} into strips', c.amtP), c.fatStep, tr('Stir-fry over high heat for 5–6 minutes with {0}', c.flavor.rub), c.veg ? tr('Add the vegetables and stir-fry for another 2 minutes') : null, c.absorbed ? tr('Add {0} and mix', c.Cd) : null] }),
  T({ id: 'sauce', kinds: ['poultry', 'fish', 'tofu', 'legume', 'ground', 'eggs'], meals: 'ld', tool: 'pot', time: 30, cooking: true, needsSauce: true,
    title: (c) => (c.kind === 'eggs' ? tr('Eggs {0}', c.flavor.phrase) : c.kind === 'fish' && c.flavor.id === 'tomato' ? tr('Chraime-style {0}', c.P) : `${c.P} ${c.flavor.phrase}`),
    steps: (c) => [c.fatStep, tr('Simmer half a can of crushed tomatoes with {0} for 5 minutes', c.flavor.rub), c.kind === 'eggs' ? tr('Crack {0} in, cover and cook for 6–8 minutes', c.amtP) : tr('Add {0} and cook covered for {1} minutes', c.amtP, c.kind === 'fish' ? 10 : c.kind === 'ground' ? 15 : 20)] }),
  T({ id: 'bowl', excludeFoods: ['egg_whites'], kinds: ['poultry', 'steak', 'fish', 'tofu', 'legume', 'canfish', 'shrimp', 'eggs'], meals: 'ld', tool: 'pan', time: 25, cooking: true, carbs: ['grain', 'tuber', 'corn', 'pasta'], absorbs: true,
    title: (c) => tr('{0} and {1} bowl {2}', c.P, c.C, c.flavor.phrase),
    steps: (c) => [c.kind === 'canfish' ? tr('Drain {0}', c.amtP) : c.kind === 'eggs' ? tr('Boil {0} for 8 minutes (hard-boiled)', c.amtP) : tr('Season {0} with {1} and cook in a pan', c.amtP, c.flavor.rub), tr('Arrange {0}, {1} and the vegetables in a bowl', c.Cd, c.Pd), c.fatStep] }),
  // ground meat
  T({ id: 'meatballs', kinds: ['ground'], meals: 'ld', tool: 'oven', time: 35, cooking: true, oven: true,
    title: (c) => tr('{0} meatballs {1}', c.P, c.flavor.phrase),
    steps: (c) => [tr('Mix {0} with {1} and finely chopped onion', c.amtP, c.flavor.rub), tr('Shape 6–8 meatballs'), c.fatStep, tr('Bake at 200°C for about 18 minutes')] }),
  T({ id: 'bolognese', kinds: ['ground'], meals: 'ld', tool: 'pot', time: 30, cooking: true, carbs: ['pasta'], absorbs: true, needsSauce: true,
    title: (c) => tr('Pasta bolognese {0}', c.flavor.phrase),
    steps: (c) => [c.fatStep, tr('Fry chopped onion and {0} until browned', c.amtP), tr('Add half a can of crushed tomatoes and {0}, and simmer for 15 minutes', c.flavor.rub), tr('Mix with the pasta')] }),
  T({ id: 'stuffed_peppers', kinds: ['ground', 'legume', 'tofu'], meals: 'ld', tool: 'oven', time: 45, cooking: true, oven: true, carbs: ['grain'], absorbs: true,
    title: (c) => tr('Stuffed peppers with {0} and {1} {2}', c.P, c.C, c.flavor.phrase),
    steps: (c) => [tr('Mix {0} with {1} and {2}', c.amtP, c.Cd, c.flavor.rub), tr('Fill 2 halved peppers'), c.fatStep, tr('Bake covered at 190°C for about 30 minutes')] }),
  T({ id: 'taco', kinds: ['ground', 'poultry', 'fish', 'tofu', 'legume', 'shrimp', 'eggs'], meals: 'bld', tool: 'pan', time: 20, cooking: true, carbs: ['tortilla'], absorbs: true,
    title: (c) => tr('{0} tacos {1}', c.P, c.flavor.phrase),
    steps: (c) => [tr('Season {0} with {1} and cook in a pan', c.amtP, c.flavor.rub), c.fatStep, tr('Fill the tortilla with {0} and the vegetables', c.Pd)] }),
  // fish & canned fish
  T({ id: 'papillote', kinds: ['fish', 'shrimp'], meals: 'ld', tool: 'oven', time: 25, cooking: true, oven: true,
    title: (c) => tr('{0} in parchment {1}', c.P, c.flavor.phrase),
    steps: (c) => [tr('Place {0} on a sheet of parchment paper', c.amtP), tr('Season with {0}', c.flavor.rub), c.fatStep, tr('Seal into a packet and bake at 200°C for about 15 minutes')] }),
  T({ id: 'canfish_salad', excludeFoods: ['egg_whites'], flavors: FRESH, kinds: ['canfish', 'eggs', 'legume', 'tofu', 'saltycheese'], meals: 'blds', tool: 'nocook', time: 10,
    title: (c) => tr('{0} salad {1}', c.P, c.flavor.phrase),
    steps: (c) => [c.kind === 'eggs' ? tr('Boil {0} for 9 minutes, cool and chop', c.amtP) : c.kind === 'saltycheese' ? tr('Cut {0} into small cubes', c.amtP) : tr('Drain {0}', c.amtP), tr('Mix with the chopped vegetables and {0}', c.flavor.rub), c.fatStep] }),
  T({ id: 'sandwich', flavors: FRESH, kinds: ['canfish', 'slices', 'softcheese', 'saltycheese', 'eggs', 'poultry', 'tofu', 'legume'], meals: 'bls', tool: 'nocook', time: 10, carbs: ['bread', 'pita', 'crackers', 'tortilla'], absorbs: true,
    title: (c) => tr('{0} with {1} {2}‖sandwich title', { pita: tr('pita'), tortilla: tr('wrap'), crackers: tr('rice cakes'), bread: tr('sandwich') }[c.carbKind], c.P, c.flavor.phrase),
    steps: (c) => [c.carbStep, c.kind === 'eggs' ? (c.pid === 'egg_whites' ? tr('Make an omelet from {0}', c.amtP) : tr('Prepare {0} (omelet or hard-boiled)', c.amtP)) : c.kind === 'canfish' ? tr('Drain {0} and season with {1}', c.amtP, c.flavor.rub) : tr('Season {0} with {1}', c.amtP, c.flavor.rub), c.fatStep, tr('Fill with {0} and the vegetables', c.Pd)] }),
  // eggs
  T({ id: 'omelette', kinds: ['eggs'], meals: 'bld', tool: 'pan', time: 10, cooking: true,
    title: (c) => tr('Omelet {0}', c.flavor.phrase),
    steps: (c) => [tr('Beat {0} with {1}', c.amtP, c.flavor.rub), c.fatStep, tr('Fry in a pan over medium heat for 2–3 minutes on each side')] }),
  T({ id: 'scramble', kinds: ['eggs', 'tofu'], meals: 'bl', tool: 'pan', time: 10, cooking: true,
    title: (c) => (c.kind === 'tofu' ? tr('{0} scramble {1}', c.P, c.flavor.phrase) : tr('Scrambled eggs {0}', c.flavor.phrase)),
    steps: (c) => [c.kind === 'tofu' ? tr('Crumble {0} by hand', c.amtP) : tr('Beat {0}', c.amtP), c.fatStep, tr('Scramble over low heat with {0} until done', c.flavor.rub)] }),
  T({ id: 'frittata', kinds: ['eggs'], meals: 'bld', tool: 'oven', time: 30, cooking: true, oven: true,
    title: (c) => tr('Baked frittata {0}', c.flavor.phrase),
    steps: (c) => [tr('Preheat the oven to 180°C'), tr('Beat {0} with the chopped vegetables and {1}', c.amtP, c.flavor.rub), c.fatStep, tr('Bake in a small dish for 20 minutes, until set')] }),
  T({ id: 'muffins', kinds: ['eggs'], meals: 'bs', tool: 'oven', time: 25, cooking: true, oven: true,
    title: (c) => tr('Egg muffins {0}', c.flavor.phrase),
    steps: (c) => [tr('Beat {0} with chopped vegetables and {1}', c.amtP, c.flavor.rub), tr('Pour into a greased muffin tin'), tr('Bake at 180°C for about 18 minutes. Keeps in the fridge for 3 days')] }),
  // dairy & powders
  T({ id: 'savory_bowl', excludeFoods: ['pro_pudding'], flavors: FRESH, kinds: ['softcheese', 'yogurt'], meals: 'bsd', tool: 'nocook', time: 5,
    title: (c) => tr('Savory {0} bowl {1}', c.P, c.flavor.phrase),
    steps: (c) => [tr('Place {0} in a bowl', c.amtP), tr('Season with {0}', c.flavor.rub), tr('Add the chopped vegetables'), c.fatStep] }),
  T({ id: 'spread', flavors: FRESH, kinds: ['softcheese', 'saltycheese'], meals: 'bsd', tool: 'nocook', time: 5, carbs: ['bread', 'pita', 'crackers', 'tortilla'], absorbs: true,
    title: (c) => tr('{0} with {1} spread {2}', c.C, c.P, c.flavor.phrase),
    steps: (c) => [c.carbStep, tr('Mix {0} with {1}', c.amtP, c.flavor.rub), tr('Spread it on and top with the vegetables'), c.fatStep] }),
  T({ id: 'parfait', carbsAllowed: ['fruit', 'oats'], kinds: ['yogurt', 'softcheese'], meals: 'bs', tool: 'nocook', time: 5, taste: 'sweet',
    title: (c) => tr('{0} parfait {1}', c.P, c.flavor.phrase),
    steps: (c) => [tr('Mix {0} with {1}', c.amtP, c.flavor.rub), (c.carbId ? tr('Layer {0} and {1} in a glass', c.Pd, c.Cd) : tr('Layer {0} in a glass', c.Pd)), c.fatStep] }),
  T({ id: 'shake', carbsAllowed: ['fruit', 'oats'], kinds: ['powder', 'yogurt', 'softcheese'], meals: 'bs', tool: 'blender', time: 5, taste: 'sweet',
    title: (c) => tr('{0} shake {1}', c.P, c.flavor.phrase),
    steps: (c) => [tr('Blend {0} in a blender with a cup of cold water and ice', c.amtP), c.carbId ? tr('Add {0}‖recipes:tpl', c.Cd) : null, tr('Add {0}', c.flavor.rub), c.fatStep] }),
  T({ id: 'protein_oats', kinds: ['powder', 'yogurt', 'softcheese', 'eggs'], meals: 'bs', tool: 'pot', time: 10, taste: 'sweet', carbs: ['oats'], absorbs: true,
    title: (c) => tr('{2} oatmeal with {0}‖title', c.P, c.flavor.phrase, c.flavor.label),
    steps: (c) => [c.carbStep, c.kind === 'eggs' ? tr('Add {0}, beaten, and stir over low heat for a minute', c.amtP) : tr('Take off the heat and stir in {0}', c.amtP), tr('Season with {0}', c.flavor.rub), c.fatStep] }),
  T({ id: 'overnight', kinds: ['powder', 'yogurt', 'softcheese'], meals: 'bs', tool: 'nocook', time: 5, taste: 'sweet', carbs: ['oats'], absorbs: true,
    title: (c) => tr('{2} overnight oats with {0}‖title', c.P, c.flavor.phrase, c.flavor.label),
    steps: (c) => [tr('In a jar, mix {0} g of oats, {1} and half a cup of water', c.carbGrams, c.amtP), tr('Add {0}', c.flavor.rub), c.fatStep, tr('Cover and leave in the fridge overnight')] }),
  T({ id: 'pancakes', excludeFoods: ['pro_pudding'], kinds: ['powder', 'eggs', 'softcheese', 'yogurt'], meals: 'bs', tool: 'pan', time: 15, cooking: true, taste: 'sweet', carbs: ['oats', 'fruit'], absorbs: true,
    title: (c) => tr('{0} pancakes {1}', c.P, c.flavor.phrase),
    steps: (c) => [(c.kind !== 'eggs' ? tr('Blend {0} with {1}, {2} and a little water into a batter', c.amtP, c.Cd, c.flavor.rub) : tr('Blend {0} with {1} and {2} into a batter', c.amtP, c.Cd, c.flavor.rub)), c.fatStep, tr('Fry small pancakes in a pan for 2 minutes on each side')] }),
  // plant
  T({ id: 'stew', kinds: ['legume'], meals: 'ld', tool: 'pot', time: 35, cooking: true,
    title: (c) => tr('{0} stew {1}', c.P, c.flavor.phrase),
    steps: (c) => [c.fatStep, tr('Fry onion and garlic for 3 minutes'), tr('Add {0} (cooked weight), {1} and a cup of water', c.amtP, c.flavor.rub), tr('Cook for 15 minutes, until thick')] }),
  T({ id: 'soup', kinds: ['legume', 'poultry'], meals: 'ld', tool: 'pot', time: 40, cooking: true,
    title: (c) => tr('{0} soup {1}', c.P, c.flavor.phrase),
    steps: (c) => [c.fatStep, tr('Fry chopped onion'), tr('Add {0}, the vegetables, {1} and 3 cups of water', c.amtP, c.flavor.rub), tr('Cook for 25 minutes')] }),
  T({ id: 'majadra', kinds: ['legume'], meals: 'ld', tool: 'pot', time: 35, cooking: true, carbs: ['grain'], absorbs: true,
    title: (c) => tr('Majadra with {0} and {1} {2}', c.P, c.C, c.flavor.phrase),
    steps: (c) => [c.fatStep, tr('Fry onion until browned'), tr('Mix {0} (cooked weight) with {1} and {2}', c.amtP, c.Cd, c.flavor.rub), tr('Heat together for 5 minutes')] }),
  T({ id: 'patties', kinds: ['legume', 'tofu', 'canfish'], meals: 'blds', tool: 'airfryer', time: 30, cooking: true,
    title: (c) => tr('{0} patties {1}', c.P, c.flavor.phrase),
    steps: (c) => [tr('Mash {0} with {1}', c.amtP, c.flavor.rub), tr('Shape 4–5 flat patties'), c.fatStep, tr('Bake in the air fryer at 190°C for about 12 minutes, or in the oven for 20 minutes')] }),
  T({ id: 'spread_legume', kinds: ['legume'], meals: 'blds', tool: 'blender', time: 10, flavors: [...FRESH, 'moroccan', 'curry', 'hawaij'],
    title: (c) => tr('Homemade {0} spread {1}', c.P, c.flavor.phrase),
    steps: (c) => [tr('Blend {0} (cooked weight) with 3–4 tablespoons of water, a little lemon and {1} until smooth', c.amtP, c.flavor.rub), c.fatStep, tr('Serve with the vegetables')] }),
  T({ id: 'warm_bowl', kinds: ['legume'], meals: 'bls', tool: 'pot', time: 10, cooking: true, flavors: [...FRESH, 'moroccan', 'hawaij', 'curry'],
    title: (c) => tr('Warm {0} bowl {1}', c.P, c.flavor.phrase),
    steps: (c) => [tr('Warm {0} (cooked weight) in a small pot with half a cup of water and {1}', c.amtP, c.flavor.rub), tr('Mash some of the legumes with a fork to thicken'), c.fatStep] }),
  T({ id: 'baked_tofu', kinds: ['tofu'], meals: 'ld', tool: 'oven', time: 35, cooking: true, oven: true,
    title: (c) => tr('Crispy {0} cubes {1}', c.P, c.flavor.phrase),
    steps: (c) => [tr('Pat {0} dry with a towel and cut into cubes', c.amtP), tr('Season with {0}', c.flavor.rub), c.fatStep, tr('Bake at 210°C for about 25 minutes')] }),
  // cold cuts / slices
  T({ id: 'rolls', flavors: FRESH, kinds: ['slices'], meals: 'bls', tool: 'nocook', time: 5,
    title: (c) => tr('{0} roll-ups {1}', c.P, c.flavor.phrase),
    steps: (c) => [tr('Lay out {0}', c.amtP), tr('Season with {0}', c.flavor.rub), tr('Roll up with the vegetables'), c.fatStep] }),
  T({ id: 'toast', kinds: ['slices', 'softcheese', 'saltycheese', 'eggs', 'canfish'], meals: 'bls', tool: 'oven', time: 10, cooking: true, carbs: ['bread', 'pita', 'tortilla'], absorbs: true,
    title: (c) => tr('{0} toasted sandwich {1}', c.P, c.flavor.phrase),
    steps: (c) => [tr('Fill {0} with {1} and season with {2}', c.Cd, c.amtP, c.flavor.rub), c.fatStep, tr('Toast in a toaster or a pan until golden')] }),

  // ---- built on the carb: for a meal the user took the protein out of ----
  T({ id: 'carb_stirfry', kinds: ['grain', 'pasta'], meals: 'ld', tool: 'pan', time: 25, cooking: true,
    title: (c) => tr('Stir-fried {0} and vegetables {1}', c.P, c.flavor.phrase),
    steps: (c) => [c.mainPrep, c.fatStep, tr('Stir-fry the vegetables for 5 minutes with {0}', c.flavor.rub), tr('Add {0} and stir over the heat for another 2 minutes', c.Pd)] }),
  T({ id: 'carb_salad', flavors: FRESH, kinds: ['grain', 'pasta', 'corn'], meals: 'blds', tool: 'nocook', time: 20,
    title: (c) => tr('{0} salad {1}', c.P, c.flavor.phrase),
    steps: (c) => [c.mainPrep, tr('Cool and mix with the chopped vegetables and {0}', c.flavor.rub), c.fatStep] }),
  T({ id: 'carb_sauce', kinds: ['pasta', 'grain'], meals: 'ld', tool: 'pot', time: 25, cooking: true, needsSauce: true,
    title: (c) => `${c.P} ${c.flavor.phrase}`,
    steps: (c) => [c.mainPrep, c.fatStep, tr('Simmer half a can of crushed tomatoes with {0} for 10 minutes', c.flavor.rub), tr('Stir in {0} and heat together', c.Pd)] }),
  T({ id: 'baked_tuber', kinds: ['tuber'], meals: 'ld', tool: 'oven', time: 40, cooking: true, oven: true,
    title: (c) => tr('Baked {0} {1}', c.P, c.flavor.phrase),
    steps: (c) => [tr('Preheat the oven to 200°C'), tr('Cut {0} into wedges and season with {1}', c.amtP, c.flavor.rub), c.fatStep, tr('Bake for 30–35 minutes, until golden and tender')] }),
  T({ id: 'tuber_mash', kinds: ['tuber'], meals: 'ld', tool: 'pot', time: 25, cooking: true,
    title: (c) => tr('Mashed {0} {1}', c.P, c.flavor.phrase),
    steps: (c) => [c.mainPrep, tr('Drain and mash with {0}', c.flavor.rub), c.fatStep] }),
  T({ id: 'veg_wrap', flavors: FRESH, kinds: ['bread', 'pita', 'tortilla', 'crackers'], meals: 'bls', tool: 'nocook', time: 10,
    title: (c) => tr('{0} with vegetables {1}', { pita: tr('pita'), tortilla: tr('wrap'), crackers: tr('rice cakes'), bread: tr('sandwich') }[c.kind], c.flavor.phrase),
    steps: (c) => [c.mainPrep, tr('Season the vegetables with {0}', c.flavor.rub), c.fatStep, tr('Fill with, or top with, the vegetables')] }),
  T({ id: 'veg_toast', kinds: ['bread', 'pita', 'tortilla'], meals: 'bls', tool: 'oven', time: 15, cooking: true,
    title: (c) => tr('Vegetable toasted sandwich {0}', c.flavor.phrase),
    steps: (c) => [tr('Fill {0} with thinly sliced vegetables and season with {1}', c.Pd, c.flavor.rub), c.fatStep, tr('Toast in a toaster or a pan until golden')] }),
  T({ id: 'porridge', kinds: ['oats'], meals: 'bs', tool: 'pot', time: 10, taste: 'sweet',
    title: (c) => tr('Oatmeal {0}', c.flavor.phrase),
    steps: (c) => [c.mainPrep, tr('Season with {0}', c.flavor.rub), c.fatStep] }),
  T({ id: 'oat_jar', kinds: ['oats'], meals: 'bs', tool: 'nocook', time: 5, taste: 'sweet',
    title: (c) => tr('Overnight oats jar {0}', c.flavor.phrase),
    steps: (c) => [tr('In a jar, mix {0} with half a cup of water or plant milk', c.amtP), tr('Add {0}', c.flavor.rub), c.fatStep, tr('Cover and leave in the fridge overnight')] }),
  T({ id: 'fruit_bowl', kinds: ['fruit'], meals: 'bs', tool: 'nocook', time: 5, taste: 'sweet',
    title: (c) => tr('{0} bowl {1}', c.P, c.flavor.phrase),
    steps: (c) => [c.mainPrep, tr('Season with {0}', c.flavor.rub), c.fatStep] }),
  T({ id: 'smoothie', kinds: ['fruit', 'oats'], meals: 'bs', tool: 'blender', time: 5, taste: 'sweet',
    title: (c) => tr('{0} smoothie {1}', c.P, c.flavor.phrase),
    steps: (c) => [tr('Blend {0} in a blender with a cup of cold water and ice', c.amtP), tr('Add {0}', c.flavor.rub), c.fatStep] }),
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
  let pItem = meal.items.find((i) => i.slot === 'protein') || itemOf(meal, 'protein');
  let cItem = meal.items.find((i) => i.slot === 'carb') || itemOf(meal, 'carb');
  // No protein in the meal (the user took it out): the carb carries the dish.
  if (!pItem) {
    pItem = cItem;
    cItem = null;
  }
  if (!pItem) return [];
  const fItem = meal.items.find((i) => i.role === 'fat');
  const vItem = meal.items.find((i) => i.role === 'veg');
  const extra = meal.items.find((i) => i.slot === 'protein2');
  // Anything else on the plate (a second carb or fat that fills a meal the
  // user took a group out of, keto's second fat) is served alongside.
  const used = new Set([pItem, cItem, fItem, vItem, extra].filter(Boolean));
  const sides = meal.items.filter((i) => !used.has(i));

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
          out.push(makeRecipe({ meal, m, flavor, p, c, fItem, vItem, extra, sides, carbKind, absorbed, kind }));
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

function makeRecipe({ meal, m, flavor, p, c, fItem, vItem, extra, sides = [], carbKind, absorbed, kind }) {
  const P = nm(p.foodId);
  const C = c ? nm(c.foodId) : '';
  const pFood = FOOD_BY_ID[p.foodId];
  const amt = pFood.discrete ? household(pFood, p.grams) : tr('{0} g', p.grams);
  // "2 תמרים", not "2 תמרים תמרים": some units already name the food.
  const amtP = SELF_UNIT.has(p.foodId) || amt.includes(P) ? amt : amountOf(amt, P);
  const carbStep = c ? carbPrep(c.foodId, c.grams, !!m.oven) : null;
  const ctx = {
    P, C, kind, flavor, amt, amtP,
    pid: p.foodId,
    Pd: def(p.foodId),
    Cd: c ? def(c.foodId) : '',
    carbId: c ? c.foodId : null,
    carbKind,
    carbGrams: c ? c.grams : 0,
    carbStep,
    mainPrep: CARB_KINDS.includes(kind) ? carbPrep(p.foodId, p.grams, !!m.oven) : null,
    absorbed,
    absorbedCarb: absorbed && c ? tr(' with {0}', C) : '',
    veg: vItem ? vItem.foodId : null,
    fatStep: fItem ? fatUse(fItem.foodId, fItem.grams, !!m.cooking) : null,
  };
  let title = m.title(ctx);
  // Fruit beside a savoury dish is dessert, not part of the dish's name.
  const fruitDessert = c && carbKind === 'fruit' && m.taste === 'savory' && !absorbed;
  if (c && !absorbed && !fruitDessert && !m.carbs && !title.includes(C)) title += tr(', served with {0}', C);
  title = upperFirst(title.replace(/\s+/g, ' ').trim());

  const steps = [];
  if (c && !absorbed && carbStep && !fruitDessert) steps.push(carbStep);
  if (vItem) {
    const v = vegPrep(vItem.foodId, vItem.grams, !!m.oven);
    if (v) steps.push(v);
  }
  for (const s of m.steps(ctx)) if (s) steps.push(s);
  if (extra) {
    const hh = household(FOOD_BY_ID[extra.foodId], extra.grams);
    steps.push(tr('Add {0} on the side to complete the protein', SELF_UNIT.has(extra.foodId) || hh.includes(nm(extra.foodId)) ? hh : amountOf(hh, nm(extra.foodId))));
  }
  for (const sd of sides) steps.push(sideStep(sd));
  // A shake or an overnight jar isn't served hot, whatever the flavour says.
  const finish = flavor.finish === SERVE_WARM && ['blender', 'nocook'].includes(m.tool) ? SERVE_COLD : flavor.finish;
  steps.push(finish === SERVE_WARM || finish === SERVE_COLD ? finish : tr('{0}, and serve', finish));
  if (fruitDessert) steps.push(tr('For dessert: {0} g {1}', c.grams, nm(c.foodId)));

  const ingredients = [{ foodId: p.foodId, grams: p.grams }];
  if (c) ingredients.push({ foodId: c.foodId, grams: c.grams });
  if (extra) ingredients.push({ foodId: extra.foodId, grams: extra.grams });
  for (const sd of sides) ingredients.push({ foodId: sd.foodId, grams: sd.grams });
  if (fItem) ingredients.push({ foodId: fItem.foodId, grams: fItem.grams });
  if (vItem) ingredients.push({ foodId: vItem.foodId, grams: vItem.grams });

  const pantry = [...new Set([...flavor.pantry, ...(m.needsSauce ? [tr('crushed tomatoes')] : []), ...(['meatballs', 'stew', 'soup', 'majadra', 'bolognese'].includes(m.id) ? [...trl('onion')] : [])])];
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
    steps: steps.map(upperFirst),
    swaps,
  };
}

// One extra item on the plate, in a sentence.
function sideStep(it) {
  const f = FOOD_BY_ID[it.foodId];
  if (f.role === 'fat') return fatUse(it.foodId, it.grams, false);
  if (f.role === 'veg') return vegPrep(it.foodId, it.grams, false);
  const prep = KIND[it.foodId] && CARB_KINDS.includes(KIND[it.foodId]) ? carbPrep(it.foodId, it.grams, false) : null;
  if (prep) return tr('{0}, and serve alongside', prep);
  const hh = household(f, it.grams);
  return tr('Serve alongside {0}', SELF_UNIT.has(it.foodId) || hh.includes(nm(it.foodId)) ? hh : amountOf(hh, nm(it.foodId)));
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
