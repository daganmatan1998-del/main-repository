import { format, raw, t as tr, trl } from './i18n.js';
// Food database. Values are per 100 g as eaten (grains/legumes cooked, meat cooked),
// rounded from USDA FoodData Central and Israeli Ministry of Health tables.
//
// role     – the macro the food is "for" in a meal: protein | carb | fat | veg | fruit
// meals    – where it fits: b breakfast, l lunch, d dinner, s snack
// src      – animal/plant source, used by diet filters
// kosher   – meat | dairy | parve ; nonKosher marks foods excluded for kosher users
// allergens– gluten, dairy, egg, peanut, treenut, soy, fish, shellfish, sesame
// units    – household measures, largest first; step = smallest sensible fraction
// min/max  – sane gram range for one serving inside a meal

const U = {
  tsp: { u: raw('{0, plural, =0.25 {{1} teaspoon} =0.5 {{1} teaspoon} =0.75 {{1} teaspoon} one {{1} teaspoon} other {{1} teaspoons}}'), g: 5, step: 0.5 },
  tbsp: (g) => ({ u: raw('{0, plural, =0.25 {{1} tablespoon} =0.5 {{1} tablespoon} =0.75 {{1} tablespoon} one {{1} tablespoon} other {{1} tablespoons}}'), g, step: 0.5 }),
  cup: (g) => ({ u: raw('{0, plural, =0.25 {{1} cup} =0.5 {{1} cup} =0.75 {{1} cup} one {{1} cup} other {{1} cups}}'), g, step: 0.25 }),
  palm: (g) => ({ u: raw('{0, plural, =0.25 {{1} palm-sized portion} =0.5 {{1} palm-sized portion} =0.75 {{1} palm-sized portion} one {{1} palm-sized portion} other {{1} palm-sized portions}}'), g, step: 0.5 }),
};

export const FOODS = [
  // ---------------- proteins ----------------
  { id: 'chicken_breast', name: tr('Grilled chicken breast'), aliases: [...trl('chicken'), ...trl('chicken breast'), ...trl('chicken thigh')], role: 'protein', kcal: 165, p: 31, c: 0, f: 3.6, meals: 'ld', src: 'poultry', kosher: 'meat', allergens: [], units: [U.palm(120)], min: 80, max: 320 },
  { id: 'turkey_breast', name: tr('Grilled turkey breast'), aliases: [...trl('turkey')], role: 'protein', kcal: 135, p: 30, c: 0, f: 1, meals: 'ld', src: 'poultry', kosher: 'meat', allergens: [], units: [U.palm(120)], min: 80, max: 320 },
  { id: 'chicken_thigh', name: tr('Grilled chicken thigh (skinless)'), aliases: [...trl('chicken thigh'), ...trl('chicken')], role: 'protein', kcal: 209, p: 26, c: 0, f: 10.9, meals: 'ld', src: 'poultry', kosher: 'meat', allergens: [], units: [U.palm(110)], min: 80, max: 300 },
  { id: 'lean_beef', name: tr('Cooked lean ground beef 5%'), aliases: [...trl('beef'), ...trl('meat'), ...trl('ground meat')], role: 'protein', kcal: 170, p: 26, c: 0, f: 7, meals: 'ld', src: 'meat', kosher: 'meat', allergens: [], units: [U.palm(120)], min: 80, max: 300 },
  { id: 'salmon', name: tr('Baked salmon'), aliases: [...trl('salmon'), ...trl('fish')], role: 'protein', kcal: 206, p: 22, c: 0, f: 12, meals: 'ld', src: 'fish', kosher: 'parve', allergens: ['fish'], units: [U.palm(120)], min: 80, max: 260 },
  { id: 'white_fish', name: tr('Baked white fish (tilapia/St. Peter\'s fish)'), aliases: [...trl('tilapia'), ...trl('St. Peter\'s fish'), ...trl('fish'), ...trl('sea bream')], role: 'protein', kcal: 128, p: 26, c: 0, f: 2.7, meals: 'ld', src: 'fish', kosher: 'parve', allergens: ['fish'], units: [U.palm(130)], min: 100, max: 320 },
  { id: 'tuna', name: tr('Tuna in water (drained)'), aliases: [...trl('tuna'), ...trl('fish')], role: 'protein', kcal: 116, p: 26, c: 0, f: 1, meals: 'blds', src: 'fish', kosher: 'parve', allergens: ['fish'], units: [{ u: raw('{0, plural, =0.25 {{1} drained can} =0.5 {{1} drained can} =0.75 {{1} drained can} one {{1} drained can} other {{1} drained cans}}'), g: 112, step: 0.5 }], min: 56, max: 224 },
  { id: 'shrimp', name: tr('Cooked shrimp'), aliases: [...trl('shrimp'), ...trl('seafood')], role: 'protein', kcal: 99, p: 24, c: 0.2, f: 0.3, meals: 'ld', src: 'shellfish', kosher: 'parve', nonKosher: true, allergens: ['shellfish'], units: [U.cup(140)], min: 100, max: 300 },
  { id: 'eggs', name: tr('Eggs'), aliases: [...trl('egg'), ...trl('omelet'), tr('Eggs')], role: 'protein', kcal: 143, p: 12.6, c: 0.7, f: 9.5, meals: 'blds', src: 'egg', kosher: 'parve', allergens: ['egg'], units: [{ u: raw('{0, plural, =0.25 {{1} egg (L)} =0.5 {{1} egg (L)} =0.75 {{1} egg (L)} one {{1} egg (L)} other {{1} eggs (L)}}'), g: 55, step: 1 }], min: 55, max: 220, discrete: true },
  { id: 'egg_whites', name: tr('Egg whites'), aliases: [...trl('egg white'), ...trl('egg')], role: 'protein', kcal: 52, p: 11, c: 0.7, f: 0.2, meals: 'bs', src: 'egg', kosher: 'parve', allergens: ['egg'], units: [{ u: raw('{0, plural, =0.25 {{1} egg white} =0.5 {{1} egg white} =0.75 {{1} egg white} one {{1} egg white} other {{1} egg whites}}'), g: 33, step: 1 }], min: 66, max: 264, discrete: true },
  { id: 'cottage', name: tr('Cottage cheese 5%'), aliases: [...trl('cottage cheese'), ...trl('cottage cheese'), ...trl('cheese')], role: 'protein', kcal: 94, p: 11, c: 3, f: 5, meals: 'bsd', src: 'dairy', kosher: 'dairy', allergens: ['dairy'], units: [{ u: raw('{0, plural, =0.25 {{1} tub (250 g)} =0.5 {{1} tub (250 g)} =0.75 {{1} tub (250 g)} one {{1} tub (250 g)} other {{1} tubs (250 g)}}'), g: 250, step: 0.25 }, U.tbsp(25)], min: 100, max: 300 },
  { id: 'white_cheese', name: tr('Soft white cheese 5%'), aliases: [...trl('white cheese'), ...trl('cheese')], role: 'protein', kcal: 98, p: 9, c: 3.5, f: 5, meals: 'bsd', src: 'dairy', kosher: 'dairy', allergens: ['dairy'], units: [U.tbsp(30)], min: 60, max: 250 },
  { id: 'greek_yogurt', name: tr('Protein / Greek yogurt 0%'), aliases: [...trl('yogurt'), ...trl('protein dessert')], role: 'protein', kcal: 59, p: 10, c: 3.6, f: 0.4, meals: 'bs', src: 'dairy', kosher: 'dairy', allergens: ['dairy'], units: [{ u: raw('{0, plural, =0.25 {{1} tub (200 g)} =0.5 {{1} tub (200 g)} =0.75 {{1} tub (200 g)} one {{1} tub (200 g)} other {{1} tubs (200 g)}}'), g: 200, step: 0.5 }], min: 150, max: 400 },
  { id: 'whey', name: tr('Protein powder (whey)'), aliases: [...trl('protein powder'), ...trl('protein shake'), ...trl('whey')], role: 'protein', kcal: 380, p: 78, c: 8, f: 5, meals: 'bs', src: 'dairy', kosher: 'dairy', allergens: ['dairy'], units: [{ u: raw('{0, plural, =0.25 {{1} scoop} =0.5 {{1} scoop} =0.75 {{1} scoop} one {{1} scoop} other {{1} scoops}}'), g: 30, step: 0.5 }], min: 15, max: 60 },
  { id: 'pea_protein', name: tr('Plant protein powder (pea)'), aliases: [...trl('protein powder'), ...trl('plant protein')], role: 'protein', kcal: 380, p: 75, c: 6, f: 7, meals: 'bs', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} scoop} =0.5 {{1} scoop} =0.75 {{1} scoop} one {{1} scoop} other {{1} scoops}}'), g: 30, step: 0.5 }], min: 15, max: 60 },
  { id: 'tofu', name: tr('Firm tofu'), aliases: [...trl('tofu'), ...trl('soy')], role: 'protein', kcal: 144, p: 15.6, c: 2.8, f: 8.7, meals: 'bld', src: 'plant', kosher: 'parve', allergens: ['soy'], units: [{ u: raw('{0, plural, =0.25 {{1} cube (100 g)} =0.5 {{1} cube (100 g)} =0.75 {{1} cube (100 g)} one {{1} cube (100 g)} other {{1} cubes (100 g)}}'), g: 100, step: 0.5 }], min: 100, max: 350 },
  { id: 'tempeh', name: tr('Tempeh'), aliases: [tr('Tempeh'), ...trl('soy')], role: 'protein', kcal: 192, p: 20, c: 7.6, f: 10.8, meals: 'ld', src: 'plant', kosher: 'parve', allergens: ['soy'], units: [U.palm(100)], min: 80, max: 250 },
  { id: 'lentils', name: tr('Cooked green lentils'), aliases: [...trl('lentils'), ...trl('legumes')], role: 'protein', kcal: 116, p: 9, c: 20, f: 0.4, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(200)], min: 120, max: 400 },
  { id: 'chickpeas', name: tr('Cooked chickpeas'), aliases: [...trl('hummus'), ...trl('legumes'), ...trl('chickpeas')], role: 'protein', kcal: 164, p: 8.9, c: 27, f: 2.6, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(165)], min: 100, max: 330 },
  { id: 'edamame', name: tr('Edamame (soybeans)'), aliases: [...trl('edamame'), ...trl('soy')], role: 'protein', kcal: 121, p: 11.9, c: 8.9, f: 5.2, meals: 'lds', src: 'plant', kosher: 'parve', allergens: ['soy'], units: [U.cup(155)], min: 100, max: 300 },
  { id: 'turkey_pastrami', name: tr('Turkey pastrami'), aliases: [...trl('pastrami'), ...trl('turkey'), ...trl('cold cuts')], role: 'protein', kcal: 110, p: 20, c: 2, f: 2, meals: 'bls', src: 'poultry', kosher: 'meat', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} slice} =0.5 {{1} slice} =0.75 {{1} slice} one {{1} slice} other {{1} slices}}'), g: 15, step: 1 }], min: 45, max: 200, discrete: true },
  { id: 'sardines', name: tr('Sardines in oil (drained)'), aliases: [...trl('sardines'), ...trl('fish')], role: 'protein', kcal: 208, p: 25, c: 0, f: 11, meals: 'bls', src: 'fish', kosher: 'parve', allergens: ['fish'], units: [{ u: raw('{0, plural, =0.25 {{1} drained can} =0.5 {{1} drained can} =0.75 {{1} drained can} one {{1} drained can} other {{1} drained cans}}'), g: 90, step: 0.5 }], min: 45, max: 180 },
  { id: 'yellow_cheese', name: tr('Yellow cheese 9%'), aliases: [...trl('yellow cheese'), ...trl('cheese')], role: 'protein', kcal: 205, p: 30, c: 1, f: 9, meals: 'bsd', src: 'dairy', kosher: 'dairy', allergens: ['dairy'], units: [{ u: raw('{0, plural, =0.25 {{1} slice} =0.5 {{1} slice} =0.75 {{1} slice} one {{1} slice} other {{1} slices}}'), g: 20, step: 1 }], min: 20, max: 120, discrete: true },
  { id: 'labane', name: tr('Labneh 5%'), aliases: [...trl('labneh'), ...trl('cheese')], role: 'protein', kcal: 90, p: 6, c: 4, f: 5, meals: 'bsd', src: 'dairy', kosher: 'dairy', allergens: ['dairy'], units: [U.tbsp(25)], min: 50, max: 250 },
  { id: 'seitan', name: tr('Seitan'), aliases: [tr('Seitan'), ...trl('gluten')], role: 'protein', kcal: 130, p: 25, c: 4, f: 2, meals: 'ld', src: 'plant', kosher: 'parve', allergens: ['gluten'], units: [U.palm(100)], min: 80, max: 250 },
  { id: 'black_beans', name: tr('Cooked black beans'), aliases: [...trl('beans'), ...trl('legumes')], role: 'protein', kcal: 132, p: 8.9, c: 23.7, f: 0.5, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(170)], min: 120, max: 400 },
  { id: 'entrecote', name: tr('Grilled entrecote'), aliases: [...trl('entrecote'), ...trl('steak'), ...trl('beef'), ...trl('meat')], role: 'protein', kcal: 291, p: 24, c: 0, f: 22, meals: 'ld', src: 'meat', kosher: 'meat', allergens: [], units: [U.palm(130)], min: 100, max: 300 },
  { id: 'beef_20', name: tr('Cooked ground beef 20%'), aliases: [...trl('beef'), ...trl('meat'), ...trl('ground meat'), ...trl('meatballs')], role: 'protein', kcal: 254, p: 26, c: 0, f: 17, meals: 'ld', src: 'meat', kosher: 'meat', allergens: [], units: [U.palm(120)], min: 80, max: 300 },
  { id: 'ground_chicken', name: tr('Cooked ground chicken'), aliases: [...trl('chicken'), ...trl('ground chicken'), ...trl('meatballs')], role: 'protein', kcal: 189, p: 23.3, c: 0, f: 10.9, meals: 'ld', src: 'poultry', kosher: 'meat', allergens: [], units: [U.palm(120)], min: 80, max: 300 },
  { id: 'ground_turkey', name: tr('Cooked ground turkey'), aliases: [...trl('turkey'), ...trl('ground turkey'), ...trl('meatballs')], role: 'protein', kcal: 176, p: 23.6, c: 0, f: 9.4, meals: 'ld', src: 'poultry', kosher: 'meat', allergens: [], units: [U.palm(120)], min: 80, max: 300 },
  { id: 'sirloin', name: tr('Grilled sirloin'), aliases: [...trl('sirloin'), ...trl('steak'), ...trl('beef'), ...trl('meat')], role: 'protein', kcal: 188, p: 29, c: 0, f: 8, meals: 'ld', src: 'meat', kosher: 'meat', allergens: [], units: [U.palm(130)], min: 100, max: 300 },
  { id: 'trout', name: tr('Baked trout'), aliases: [...trl('trout'), ...trl('fish')], role: 'protein', kcal: 168, p: 23.8, c: 0, f: 7.4, meals: 'ld', src: 'fish', kosher: 'parve', allergens: ['fish'], units: [U.palm(130)], min: 100, max: 280 },
  { id: 'hake', name: tr('Baked hake (cod) fillet'), aliases: [...trl('hake'), ...trl('cod'), ...trl('fish')], role: 'protein', kcal: 105, p: 23, c: 0, f: 0.9, meals: 'ld', src: 'fish', kosher: 'parve', allergens: ['fish'], units: [U.palm(130)], min: 100, max: 330 },
  { id: 'bulgarian', name: tr('Bulgarian cheese 5%'), aliases: [...trl('bulgarian cheese'), ...trl('salty cheese'), ...trl('cheese')], role: 'protein', kcal: 113, p: 16, c: 1, f: 5, meals: 'bsd', src: 'dairy', kosher: 'dairy', allergens: ['dairy'], units: [U.tbsp(20)], min: 40, max: 200 },
  { id: 'skyr', name: tr('Skyr / quark 0%'), aliases: [...trl('skyr'), ...trl('quark'), ...trl('yogurt')], role: 'protein', kcal: 62, p: 11, c: 4, f: 0.2, meals: 'bs', src: 'dairy', kosher: 'dairy', allergens: ['dairy'], units: [{ u: raw('{0, plural, =0.25 {{1} tub (150 g)} =0.5 {{1} tub (150 g)} =0.75 {{1} tub (150 g)} one {{1} tub (150 g)} other {{1} tubs (150 g)}}'), g: 150, step: 0.5 }], min: 150, max: 450 },
  { id: 'pro_pudding', name: tr('Protein dessert‖name'), aliases: [...trl('dessert'), ...trl('protein dessert'), ...trl('pudding')], role: 'protein', kcal: 72, p: 10, c: 6, f: 1, meals: 'bs', src: 'dairy', kosher: 'dairy', allergens: ['dairy'], units: [{ u: raw('{0, plural, =0.25 {{1} tub (200 g)} =0.5 {{1} tub (200 g)} =0.75 {{1} tub (200 g)} one {{1} tub (200 g)} other {{1} tubs (200 g)}}'), g: 200, step: 0.5 }], min: 100, max: 400 },
  { id: 'soy_chunks', name: tr('Soy granules (soaked and cooked)'), aliases: [...trl('soy granules'), ...trl('soy'), ...trl('soy chunks')], role: 'protein', kcal: 110, p: 16.7, c: 10, f: 0.3, meals: 'ld', src: 'plant', kosher: 'parve', allergens: ['soy'], units: [U.cup(150)], min: 90, max: 360 },
  { id: 'white_beans', name: tr('Cooked white beans'), aliases: [...trl('beans'), ...trl('white beans'), ...trl('legumes')], role: 'protein', kcal: 139, p: 9.7, c: 25, f: 0.4, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(180)], min: 120, max: 400 },

  // ---------------- carbs ----------------
  { id: 'white_rice', name: tr('Cooked white rice'), aliases: [...trl('rice')], role: 'carb', kcal: 130, p: 2.7, c: 28, f: 0.3, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(160), U.tbsp(15)], min: 60, max: 400 },
  { id: 'brown_rice', name: tr('Cooked brown rice'), aliases: [...trl('rice')], role: 'carb', kcal: 123, p: 2.7, c: 25.6, f: 1, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(160), U.tbsp(15)], min: 60, max: 400 },
  { id: 'quinoa', name: tr('Cooked quinoa'), aliases: [...trl('quinoa')], role: 'carb', kcal: 120, p: 4.4, c: 21.3, f: 1.9, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(170), U.tbsp(15)], min: 60, max: 400 },
  { id: 'pasta', name: tr('Cooked pasta'), aliases: [...trl('pasta'), ...trl('spaghetti')], role: 'carb', kcal: 158, p: 5.8, c: 31, f: 0.9, meals: 'ld', src: 'plant', kosher: 'parve', allergens: ['gluten'], units: [U.cup(140)], min: 60, max: 400 },
  { id: 'sweet_potato', name: tr('Baked sweet potato'), aliases: [...trl('sweet potato')], role: 'carb', kcal: 90, p: 2, c: 20.7, f: 0.2, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} medium sweet potato} =0.5 {{1} medium sweet potato} =0.75 {{1} medium sweet potato} one {{1} medium sweet potato} other {{1} medium sweet potatoes}}'), g: 150, step: 0.5 }], min: 80, max: 500 },
  { id: 'potato', name: tr('Boiled potato'), aliases: [...trl('potato'), ...trl('potatoes'), ...trl('potato')], role: 'carb', kcal: 87, p: 1.9, c: 20, f: 0.1, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} medium potato} =0.5 {{1} medium potato} =0.75 {{1} medium potato} one {{1} medium potato} other {{1} medium potatoes}}'), g: 150, step: 0.5 }], min: 80, max: 500 },
  { id: 'buckwheat', name: tr('Cooked buckwheat'), aliases: [...trl('buckwheat')], role: 'carb', kcal: 92, p: 3.4, c: 20, f: 0.6, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(170), U.tbsp(15)], min: 60, max: 450 },
  { id: 'bulgur', name: tr('Cooked bulgur'), aliases: [...trl('bulgur')], role: 'carb', kcal: 83, p: 3.1, c: 18.6, f: 0.2, meals: 'ld', src: 'plant', kosher: 'parve', allergens: ['gluten'], units: [U.cup(180), U.tbsp(15)], min: 60, max: 450 },
  { id: 'couscous', name: tr('Cooked couscous'), aliases: [...trl('couscous')], role: 'carb', kcal: 112, p: 3.8, c: 23, f: 0.2, meals: 'ld', src: 'plant', kosher: 'parve', allergens: ['gluten'], units: [U.cup(157), U.tbsp(15)], min: 60, max: 400 },
  { id: 'wholewheat_bread', name: tr('Whole wheat bread'), aliases: [...trl('bread'), tr('slice')], role: 'carb', kcal: 247, p: 13, c: 41, f: 3.4, meals: 'bls', src: 'plant', kosher: 'parve', allergens: ['gluten'], units: [{ u: raw('{0, plural, =0.25 {{1} slice} =0.5 {{1} slice} =0.75 {{1} slice} one {{1} slice} other {{1} slices}}'), g: 30, step: 1 }], min: 30, max: 150, discrete: true },
  { id: 'pita', name: tr('Whole wheat pita'), aliases: [...trl('pita'), ...trl('bread')], role: 'carb', kcal: 262, p: 9.8, c: 55, f: 2.6, meals: 'l', src: 'plant', kosher: 'parve', allergens: ['gluten'], units: [{ u: raw('{0, plural, =0.25 {{1} pita} =0.5 {{1} pita} =0.75 {{1} pita} one {{1} pita} other {{1} pitas}}'), g: 90, step: 0.5 }], min: 45, max: 180, discrete: true },
  { id: 'oats', name: tr('Oats'), aliases: [...trl('quaker'), ...trl('oat'), ...trl('porridge')], role: 'carb', kcal: 389, p: 16.9, c: 66, f: 6.9, meals: 'bs', src: 'plant', kosher: 'parve', allergens: ['gluten'], units: [{ u: raw('{0, plural, =0.25 {{1} half cup} =0.5 {{1} half cup} =0.75 {{1} half cup} one {{1} half cup} other {{1} half cups}}'), g: 40, step: 0.5 }, U.tbsp(10)], min: 20, max: 120 },
  { id: 'rice_cakes', name: tr('Rice cakes'), aliases: [...trl('rice cakes'), ...trl('rice cake')], role: 'carb', kcal: 387, p: 8, c: 81, f: 2.8, meals: 'bs', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} rice cake} =0.5 {{1} rice cake} =0.75 {{1} rice cake} one {{1} rice cake} other {{1} rice cakes}}'), g: 9, step: 1 }], min: 18, max: 72, discrete: true },
  { id: 'gf_bread', name: tr('Gluten-free bread'), aliases: [...trl('bread')], role: 'carb', kcal: 250, p: 4, c: 46, f: 5, meals: 'bs', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} slice} =0.5 {{1} slice} =0.75 {{1} slice} one {{1} slice} other {{1} slices}}'), g: 35, step: 1 }], min: 35, max: 140, discrete: true },
  { id: 'corn', name: tr('Sweet corn'), aliases: [...trl('corn')], role: 'carb', kcal: 96, p: 3.4, c: 21, f: 1.5, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(150)], min: 60, max: 400 },
  { id: 'freekeh', name: tr('Cooked freekeh'), aliases: [...trl('freekeh'), ...trl('freekeh')], role: 'carb', kcal: 125, p: 5, c: 25, f: 0.8, meals: 'ld', src: 'plant', kosher: 'parve', allergens: ['gluten'], units: [U.cup(160), U.tbsp(15)], min: 60, max: 400 },
  { id: 'rye_bread', name: tr('Rye bread'), aliases: [...trl('bread'), ...trl('rye'), tr('slice')], role: 'carb', kcal: 259, p: 9, c: 48, f: 3.3, meals: 'bls', src: 'plant', kosher: 'parve', allergens: ['gluten'], units: [{ u: raw('{0, plural, =0.25 {{1} slice} =0.5 {{1} slice} =0.75 {{1} slice} one {{1} slice} other {{1} slices}}'), g: 32, step: 1 }], min: 32, max: 160, discrete: true },
  { id: 'tortilla', name: tr('Whole wheat tortilla'), aliases: [...trl('tortilla'), ...trl('lafa'), ...trl('bread')], role: 'carb', kcal: 295, p: 9, c: 49, f: 7, meals: 'bl', src: 'plant', kosher: 'parve', allergens: ['gluten'], units: [{ u: raw('{0, plural, =0.25 {{1} tortilla} =0.5 {{1} tortilla} =0.75 {{1} tortilla} one {{1} tortilla} other {{1} tortillas}}'), g: 45, step: 0.5 }], min: 45, max: 180, discrete: true },
  { id: 'barley', name: tr('Cooked barley groats (pearl barley)'), aliases: [...trl('barley groats'), ...trl('barley')], role: 'carb', kcal: 123, p: 2.3, c: 28, f: 0.4, meals: 'ld', src: 'plant', kosher: 'parve', allergens: ['gluten'], units: [U.cup(160), U.tbsp(15)], min: 60, max: 400 },
  { id: 'millet', name: tr('Cooked millet'), aliases: [...trl('millet')], role: 'carb', kcal: 119, p: 3.5, c: 23.7, f: 1, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(175), U.tbsp(15)], min: 60, max: 400 },
  { id: 'ptitim', name: tr('Cooked ptitim (Israeli couscous)'), aliases: [...trl('ptitim'), ...trl('pasta')], role: 'carb', kcal: 156, p: 5.5, c: 31, f: 0.8, meals: 'ld', src: 'plant', kosher: 'parve', allergens: ['gluten'], units: [U.cup(150), U.tbsp(15)], min: 60, max: 400 },
  { id: 'whole_pasta', name: tr('Cooked whole wheat pasta'), aliases: [...trl('pasta'), ...trl('spaghetti')], role: 'carb', kcal: 149, p: 6, c: 30, f: 1.7, meals: 'ld', src: 'plant', kosher: 'parve', allergens: ['gluten'], units: [U.cup(140)], min: 60, max: 400 },
  { id: 'gf_pasta', name: tr('Cooked gluten-free pasta'), aliases: [...trl('pasta'), ...trl('spaghetti')], role: 'carb', kcal: 153, p: 3, c: 33, f: 1, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(140)], min: 60, max: 400 },
  { id: 'rice_noodles', name: tr('Cooked rice noodles'), aliases: [...trl('noodles'), ...trl('noodles')], role: 'carb', kcal: 108, p: 1.8, c: 24, f: 0.2, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(175)], min: 80, max: 450 },
  { id: 'green_peas', name: tr('Green peas'), aliases: [...trl('peas')], role: 'carb', kcal: 84, p: 5.4, c: 15.6, f: 0.2, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(160)], min: 80, max: 400 },
  { id: 'whole_bun', name: tr('Whole wheat bun'), aliases: [...trl('bun'), ...trl('bun'), ...trl('bread')], role: 'carb', kcal: 250, p: 10, c: 43, f: 4, meals: 'bls', src: 'plant', kosher: 'parve', allergens: ['gluten'], units: [{ u: raw('{0, plural, =0.25 {{1} bun} =0.5 {{1} bun} =0.75 {{1} bun} one {{1} bun} other {{1} buns}}'), g: 60, step: 0.5 }], min: 30, max: 180, discrete: true },
  { id: 'crispbread', name: tr('Crispbread (whole grain cracker)'), aliases: [...trl('crispbread'), ...trl('cracker'), ...trl('wasa')], role: 'carb', kcal: 340, p: 10, c: 66, f: 2, meals: 'bs', src: 'plant', kosher: 'parve', allergens: ['gluten'], units: [{ u: raw('{0, plural, =0.25 {{1} crispbread slice} =0.5 {{1} crispbread slice} =0.75 {{1} crispbread slice} one {{1} crispbread slice} other {{1} crispbread slices}}'), g: 11, step: 1 }], min: 22, max: 88, discrete: true },

  // ---------------- fats ----------------
  { id: 'olive_oil', name: tr('Olive oil'), aliases: [...trl('oil')], role: 'fat', kcal: 884, p: 0, c: 0, f: 100, meals: 'bld', src: 'plant', kosher: 'parve', allergens: [], units: [U.tbsp(14), U.tsp], min: 3, max: 30 },
  { id: 'avocado', name: tr('Avocado'), aliases: [tr('Avocado')], role: 'fat', kcal: 160, p: 2, c: 8.5, f: 14.7, meals: 'bld', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} avocado quarter} =0.5 {{1} avocado quarter} =0.75 {{1} avocado quarter} one {{1} avocado quarter} other {{1} avocado quarters}}'), g: 40, step: 0.5 }], min: 20, max: 160 },
  { id: 'tahini', name: tr('Raw tahini'), aliases: [...trl('tahini'), ...trl('sesame')], role: 'fat', kcal: 595, p: 17, c: 21, f: 54, meals: 'bld', src: 'plant', kosher: 'parve', allergens: ['sesame'], units: [U.tbsp(15)], min: 8, max: 45 },
  { id: 'almonds', name: tr('Almonds'), aliases: [tr('Almonds'), ...trl('nuts')], role: 'fat', kcal: 579, p: 21, c: 22, f: 50, meals: 'bs', src: 'plant', kosher: 'parve', allergens: ['treenut'], units: [{ u: raw('{0, plural, =0.25 {{1} small handful (~10 almonds)} =0.5 {{1} small handful (~10 almonds)} =0.75 {{1} small handful (~10 almonds)} one {{1} small handful (~10 almonds)} other {{1} small handfuls}}'), g: 12, step: 0.5 }], min: 6, max: 50 },
  { id: 'walnuts', name: tr('Walnuts'), aliases: [...trl('nuts'), ...trl('walnut')], role: 'fat', kcal: 654, p: 15, c: 14, f: 65, meals: 'bs', src: 'plant', kosher: 'parve', allergens: ['treenut'], units: [{ u: raw('{0, plural, =0.25 {{1} walnut half} =0.5 {{1} walnut half} =0.75 {{1} walnut half} one {{1} walnut half} other {{1} walnut halves}}'), g: 2.5, step: 1 }], min: 5, max: 40 },
  { id: 'peanut_butter', name: tr('Natural peanut butter'), aliases: [...trl('peanut butter'), ...trl('peanuts')], role: 'fat', kcal: 588, p: 25, c: 20, f: 50, meals: 'bs', src: 'plant', kosher: 'parve', allergens: ['peanut'], units: [U.tbsp(16), U.tsp], min: 8, max: 40 },
  { id: 'chia', name: tr('Chia seeds'), aliases: [...trl('chia'), ...trl('chia'), ...trl('seeds')], role: 'fat', kcal: 486, p: 17, c: 42, f: 31, meals: 'bs', src: 'plant', kosher: 'parve', allergens: [], units: [U.tbsp(12)], min: 6, max: 36 },
  { id: 'olives', name: tr('Olives'), aliases: [...trl('olive'), tr('Olives')], role: 'fat', kcal: 115, p: 0.8, c: 6, f: 11, meals: 'bld', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} olive} =0.5 {{1} olive} =0.75 {{1} olive} one {{1} olive} other {{1} olives}}'), g: 4, step: 1 }], min: 20, max: 60 },
  { id: 'cashews', name: tr('Cashews'), aliases: [tr('Cashews'), ...trl('nuts')], role: 'fat', kcal: 570, p: 18, c: 30, f: 44, meals: 'bs', src: 'plant', kosher: 'parve', allergens: ['treenut'], units: [{ u: raw('{0, plural, =0.25 {{1} small handful (~10 cashews)} =0.5 {{1} small handful (~10 cashews)} =0.75 {{1} small handful (~10 cashews)} one {{1} small handful (~10 cashews)} other {{1} small handfuls}}'), g: 15, step: 0.5 }], min: 8, max: 50 },
  { id: 'flaxseed', name: tr('Ground flaxseed'), aliases: [...trl('flax'), ...trl('seeds')], role: 'fat', kcal: 534, p: 18, c: 29, f: 42, meals: 'bs', src: 'plant', kosher: 'parve', allergens: [], units: [U.tbsp(10)], min: 5, max: 30 },
  { id: 'pumpkin_seeds', name: tr('Hulled pumpkin seeds'), aliases: [...trl('seeds'), ...trl('pumpkin'), ...trl('seeds')], role: 'fat', kcal: 559, p: 30, c: 11, f: 49, meals: 'bsld', src: 'plant', kosher: 'parve', allergens: [], units: [U.tbsp(10)], min: 5, max: 40 },
  { id: 'butter', name: tr('Butter'), aliases: [tr('Butter')], role: 'fat', kcal: 717, p: 0.9, c: 0.1, f: 81, meals: 'blsd', src: 'dairy', kosher: 'dairy', allergens: ['dairy'], units: [U.tbsp(14), U.tsp], min: 3, max: 30 },
  { id: 'hard_cheese', name: tr('Hard cheese 28% (Parmesan/cheddar)'), aliases: [...trl('hard cheese'), ...trl('parmesan'), ...trl('cheddar'), ...trl('cheese')], role: 'fat', kcal: 402, p: 25, c: 1.3, f: 33, meals: 'blsd', src: 'dairy', kosher: 'dairy', allergens: ['dairy'], units: [{ u: raw('{0, plural, =0.25 {{1} slice} =0.5 {{1} slice} =0.75 {{1} slice} one {{1} slice} other {{1} slices}}'), g: 20, step: 1 }], min: 10, max: 80 },
  { id: 'pistachios', name: tr('Shelled pistachios'), aliases: [...trl('pistachio'), ...trl('nuts')], role: 'fat', kcal: 560, p: 20, c: 28, f: 45, meals: 'bs', src: 'plant', kosher: 'parve', allergens: ['treenut'], units: [{ u: raw('{0, plural, =0.25 {{1} small handful (~20 pistachios)} =0.5 {{1} small handful (~20 pistachios)} =0.75 {{1} small handful (~20 pistachios)} one {{1} small handful (~20 pistachios)} other {{1} small handfuls}}'), g: 15, step: 0.5 }], min: 8, max: 45 },
  { id: 'hazelnuts', name: tr('Hazelnuts'), aliases: [...trl('hazelnut'), ...trl('nuts')], role: 'fat', kcal: 628, p: 15, c: 17, f: 61, meals: 'bs', src: 'plant', kosher: 'parve', allergens: ['treenut'], units: [{ u: raw('{0, plural, =0.25 {{1} small handful (~10 nuts)} =0.5 {{1} small handful (~10 nuts)} =0.75 {{1} small handful (~10 nuts)} one {{1} small handful (~10 nuts)} other {{1} small handfuls}}'), g: 14, step: 0.5 }], min: 6, max: 40 },
  { id: 'peanuts', name: tr('Unsalted roasted peanuts'), aliases: [...trl('peanuts')], role: 'fat', kcal: 585, p: 24, c: 21, f: 50, meals: 'bs', src: 'plant', kosher: 'parve', allergens: ['peanut'], units: [{ u: raw('{0, plural, =0.25 {{1} small handful (~20 peanuts)} =0.5 {{1} small handful (~20 peanuts)} =0.75 {{1} small handful (~20 peanuts)} one {{1} small handful (~20 peanuts)} other {{1} small handfuls}}'), g: 15, step: 0.5 }], min: 8, max: 45 },
  { id: 'sunflower_seeds', name: tr('Hulled sunflower seeds'), aliases: [...trl('seeds'), ...trl('sunflower'), ...trl('seeds')], role: 'fat', kcal: 584, p: 21, c: 20, f: 51, meals: 'bsld', src: 'plant', kosher: 'parve', allergens: [], units: [U.tbsp(9)], min: 5, max: 40 },
  { id: 'sesame_seeds', name: tr('Sesame seeds‖name'), aliases: [...trl('sesame'), ...trl('seeds')], role: 'fat', kcal: 573, p: 18, c: 23, f: 50, meals: 'bsld', src: 'plant', kosher: 'parve', allergens: ['sesame'], units: [U.tbsp(9)], min: 5, max: 30 },
  { id: 'almond_butter', name: tr('Almond butter'), aliases: [tr('Almond butter'), tr('Almonds')], role: 'fat', kcal: 614, p: 21, c: 19, f: 56, meals: 'bs', src: 'plant', kosher: 'parve', allergens: ['treenut'], units: [U.tbsp(16), U.tsp], min: 8, max: 40 },
  { id: 'canola_oil', name: tr('Canola oil'), aliases: [...trl('oil'), ...trl('canola')], role: 'fat', kcal: 884, p: 0, c: 0, f: 100, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.tbsp(14), U.tsp], min: 3, max: 30 },
  { id: 'hummus_spread', name: tr('Hummus spread'), aliases: [...trl('hummus'), ...trl('spread')], role: 'fat', kcal: 166, p: 8, c: 14, f: 9.6, meals: 'bld', src: 'plant', kosher: 'parve', allergens: ['sesame'], units: [U.tbsp(20)], min: 30, max: 150 },
  { id: 'mozzarella', name: tr('Mozzarella'), aliases: [tr('Mozzarella'), ...trl('cheese')], role: 'fat', kcal: 280, p: 22, c: 2, f: 21, meals: 'blsd', src: 'dairy', kosher: 'dairy', allergens: ['dairy'], units: [{ u: raw('{0, plural, =0.25 {{1} small ball (50 g)} =0.5 {{1} small ball (50 g)} =0.75 {{1} small ball (50 g)} one {{1} small ball (50 g)} other {{1} small balls (50 g)}}'), g: 50, step: 0.5 }], min: 20, max: 120 },
  { id: 'feta', name: tr('Feta cheese 16%'), aliases: [...trl('feta'), ...trl('salty cheese'), ...trl('cheese')], role: 'fat', kcal: 230, p: 15, c: 3, f: 17.5, meals: 'blsd', src: 'dairy', kosher: 'dairy', allergens: ['dairy'], units: [U.tbsp(15)], min: 15, max: 100 },
  { id: 'cream_cheese', name: tr('Cream cheese 30%'), aliases: [...trl('cream cheese'), ...trl('cream'), ...trl('cheese')], role: 'fat', kcal: 306, p: 6, c: 3, f: 30, meals: 'bsd', src: 'dairy', kosher: 'dairy', allergens: ['dairy'], units: [U.tbsp(15)], min: 10, max: 75 },
  { id: 'ghee', name: tr('Ghee (clarified butter)'), aliases: [...trl('ghee'), tr('Butter')], role: 'fat', kcal: 900, p: 0, c: 0, f: 100, meals: 'bld', src: 'dairy', kosher: 'dairy', allergens: ['dairy'], units: [U.tbsp(13), U.tsp], min: 3, max: 30 },

  // ---------------- vegetables (fixed portion, near-free) ----------------
  { id: 'salad', name: tr('Vegetable salad (tomato, cucumber, pepper)'), aliases: [...trl('salad'), ...trl('vegetables'), ...trl('tomato'), ...trl('cucumber'), ...trl('pepper')], role: 'veg', kcal: 20, p: 0.9, c: 4, f: 0.2, meals: 'bld', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} medium bowl} =0.5 {{1} medium bowl} =0.75 {{1} medium bowl} one {{1} medium bowl} other {{1} medium bowls}}'), g: 200, step: 0.5 }], min: 100, max: 300, portion: 200 },
  { id: 'broccoli', name: tr('Steamed broccoli'), aliases: [...trl('broccoli'), ...trl('vegetables')], role: 'veg', kcal: 35, p: 2.4, c: 7, f: 0.4, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(155)], min: 100, max: 300, portion: 150 },
  { id: 'green_beans', name: tr('Steamed green beans'), aliases: [...trl('beans'), ...trl('vegetables')], role: 'veg', kcal: 35, p: 1.9, c: 7.9, f: 0.3, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(125)], min: 100, max: 300, portion: 150 },
  { id: 'roasted_veg', name: tr('Roasted vegetables (zucchini, pepper, onion)'), aliases: [...trl('zucchini'), ...trl('vegetables'), ...trl('onion'), ...trl('pepper')], role: 'veg', kcal: 35, p: 1.2, c: 7, f: 0.3, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(150)], min: 100, max: 300, portion: 180 },
  { id: 'leafy', name: tr('Leafy green salad'), aliases: [...trl('lettuce'), ...trl('leaves'), ...trl('vegetables'), ...trl('spinach')], role: 'veg', kcal: 20, p: 1.8, c: 3.3, f: 0.3, meals: 'bld', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} bowl} =0.5 {{1} bowl} =0.75 {{1} bowl} one {{1} bowl} other {{1} bowls}}'), g: 100, step: 0.5 }], min: 60, max: 200, portion: 120 },
  { id: 'carrot', name: tr('Carrot'), aliases: [tr('Carrot'), ...trl('vegetables')], role: 'veg', kcal: 41, p: 0.9, c: 9.6, f: 0.2, meals: 'bls', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} medium carrot} =0.5 {{1} medium carrot} =0.75 {{1} medium carrot} one {{1} medium carrot} other {{1} medium carrots}}'), g: 70, step: 0.5 }], min: 70, max: 210, portion: 140 },
  { id: 'spinach', name: tr('Steamed spinach'), aliases: [...trl('spinach'), ...trl('vegetables'), ...trl('leaves')], role: 'veg', kcal: 23, p: 2.9, c: 3.6, f: 0.4, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(180)], min: 80, max: 250, portion: 150 },
  { id: 'cauliflower', name: tr('Roasted cauliflower'), aliases: [...trl('cauliflower'), ...trl('vegetables')], role: 'veg', kcal: 25, p: 1.9, c: 5, f: 0.3, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(125)], min: 100, max: 300, portion: 160 },
  { id: 'mushrooms', name: tr('Sautéed mushrooms'), aliases: [...trl('mushrooms'), ...trl('vegetables')], role: 'veg', kcal: 22, p: 3.1, c: 3.3, f: 0.3, meals: 'bld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(110)], min: 80, max: 250, portion: 130 },
  { id: 'cucumber', name: tr('Cucumber‖name'), aliases: [...trl('cucumber'), ...trl('vegetables')], role: 'veg', kcal: 15, p: 0.7, c: 3.6, f: 0.1, meals: 'bls', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} medium cucumber} =0.5 {{1} medium cucumber} =0.75 {{1} medium cucumber} one {{1} medium cucumber} other {{1} medium cucumbers}}'), g: 100, step: 0.5 }], min: 100, max: 300, portion: 200 },
  { id: 'tomato', name: tr('Tomatoes'), aliases: [...trl('tomato'), tr('Tomatoes'), ...trl('vegetables')], role: 'veg', kcal: 18, p: 0.9, c: 3.9, f: 0.2, meals: 'bld', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} medium tomato} =0.5 {{1} medium tomato} =0.75 {{1} medium tomato} one {{1} medium tomato} other {{1} medium tomatoes}}'), g: 120, step: 0.5 }], min: 100, max: 300, portion: 180 },
  { id: 'peppers', name: tr('Bell peppers (mixed colors)'), aliases: [...trl('pepper'), ...trl('vegetables')], role: 'veg', kcal: 28, p: 1, c: 6, f: 0.3, meals: 'bls', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} medium pepper} =0.5 {{1} medium pepper} =0.75 {{1} medium pepper} one {{1} medium pepper} other {{1} medium peppers}}'), g: 150, step: 0.5 }], min: 75, max: 300, portion: 150 },
  { id: 'zucchini', name: tr('Steamed zucchini'), aliases: [...trl('zucchini'), ...trl('vegetables')], role: 'veg', kcal: 17, p: 1.2, c: 3.1, f: 0.3, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(180)], min: 100, max: 300, portion: 180 },
  { id: 'eggplant', name: tr('Roasted eggplant'), aliases: [...trl('eggplant'), ...trl('vegetables')], role: 'veg', kcal: 35, p: 0.8, c: 8.7, f: 0.2, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(100)], min: 100, max: 300, portion: 150 },
  { id: 'cabbage', name: tr('Cabbage salad'), aliases: [...trl('cabbage'), ...trl('vegetables')], role: 'veg', kcal: 25, p: 1.3, c: 5.8, f: 0.1, meals: 'bld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(90)], min: 80, max: 250, portion: 150 },
  { id: 'asparagus', name: tr('Roasted asparagus'), aliases: [...trl('asparagus'), ...trl('vegetables')], role: 'veg', kcal: 22, p: 2.4, c: 4.1, f: 0.2, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(135)], min: 80, max: 250, portion: 150 },
  { id: 'brussels', name: tr('Roasted Brussels sprouts'), aliases: [...trl('brussels sprouts'), ...trl('vegetables')], role: 'veg', kcal: 36, p: 2.6, c: 7.1, f: 0.5, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(155)], min: 80, max: 250, portion: 150 },
  { id: 'pumpkin', name: tr('Roasted pumpkin'), aliases: [...trl('pumpkin'), ...trl('vegetables')], role: 'veg', kcal: 26, p: 1, c: 6.5, f: 0.1, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(245)], min: 100, max: 300, portion: 180 },
  { id: 'beets', name: tr('Cooked beets'), aliases: [...trl('beet'), ...trl('vegetables')], role: 'veg', kcal: 44, p: 1.7, c: 10, f: 0.2, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} medium beet} =0.5 {{1} medium beet} =0.75 {{1} medium beet} one {{1} medium beet} other {{1} medium beets}}'), g: 80, step: 0.5 }], min: 80, max: 240, portion: 120 },

  // ---------------- fruit ----------------
  { id: 'banana', name: tr('Banana'), aliases: [tr('Banana'), ...trl('fruit')], role: 'fruit', kcal: 89, p: 1.1, c: 22.8, f: 0.3, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} medium banana} =0.5 {{1} medium banana} =0.75 {{1} medium banana} one {{1} medium banana} other {{1} medium bananas}}'), g: 120, step: 0.25 }], min: 60, max: 240, portion: 120 },
  { id: 'apple', name: tr('Apple'), aliases: [...trl('apple'), ...trl('fruit')], role: 'fruit', kcal: 52, p: 0.3, c: 13.8, f: 0.2, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} medium apple} =0.5 {{1} medium apple} =0.75 {{1} medium apple} one {{1} medium apple} other {{1} medium apples}}'), g: 180, step: 0.25 }], min: 90, max: 360, portion: 180 },
  { id: 'berries', name: tr('Berries'), aliases: [tr('Berries'), ...trl('strawberry'), ...trl('fruit')], role: 'fruit', kcal: 50, p: 0.7, c: 12, f: 0.3, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(140)], min: 70, max: 300, portion: 140 },
  { id: 'orange', name: tr('Orange'), aliases: [tr('Orange'), ...trl('citrus'), ...trl('fruit')], role: 'fruit', kcal: 47, p: 0.9, c: 11.8, f: 0.1, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} medium orange} =0.5 {{1} medium orange} =0.75 {{1} medium orange} one {{1} medium orange} other {{1} medium oranges}}'), g: 160, step: 0.25 }], min: 80, max: 320, portion: 160 },
  { id: 'dates', name: tr('Medjool dates'), aliases: [...trl('date'), ...trl('dates'), ...trl('fruit')], role: 'fruit', kcal: 282, p: 2.5, c: 75, f: 0.4, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} date} =0.5 {{1} date} =0.75 {{1} date} one {{1} date} other {{1} dates}}'), g: 24, step: 1 }], min: 24, max: 96, portion: 48, discrete: true },
  { id: 'grapes', name: tr('Grapes'), aliases: [tr('Grapes'), ...trl('fruit')], role: 'fruit', kcal: 69, p: 0.7, c: 18, f: 0.2, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(150)], min: 75, max: 300, portion: 150 },
  { id: 'pear', name: tr('Pear'), aliases: [tr('Pear'), ...trl('fruit')], role: 'fruit', kcal: 57, p: 0.4, c: 15, f: 0.1, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} medium pear} =0.5 {{1} medium pear} =0.75 {{1} medium pear} one {{1} medium pear} other {{1} medium pears}}'), g: 170, step: 0.25 }], min: 85, max: 340, portion: 170 },
  { id: 'kiwi', name: tr('Kiwi'), aliases: [tr('Kiwi'), ...trl('fruit')], role: 'fruit', kcal: 61, p: 1.1, c: 15, f: 0.5, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} kiwi} =0.5 {{1} kiwi} =0.75 {{1} kiwi} one {{1} kiwi} other {{1} kiwis}}'), g: 75, step: 1 }], min: 75, max: 300, portion: 150, discrete: true },
  { id: 'mango', name: tr('Mango'), aliases: [tr('Mango'), ...trl('fruit')], role: 'fruit', kcal: 60, p: 0.8, c: 15, f: 0.4, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(165)], min: 80, max: 330, portion: 165 },
  { id: 'watermelon', name: tr('Watermelon'), aliases: [tr('Watermelon'), ...trl('fruit')], role: 'fruit', kcal: 30, p: 0.6, c: 7.6, f: 0.2, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} medium wedge} =0.5 {{1} medium wedge} =0.75 {{1} medium wedge} one {{1} medium wedge} other {{1} medium wedges}}'), g: 280, step: 0.5 }], min: 150, max: 600, portion: 300 },
  { id: 'melon', name: tr('Melon'), aliases: [tr('Melon'), ...trl('fruit')], role: 'fruit', kcal: 34, p: 0.8, c: 8.2, f: 0.2, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(160)], min: 120, max: 500, portion: 240 },
  { id: 'peach', name: tr('Peach'), aliases: [tr('Peach'), ...trl('fruit')], role: 'fruit', kcal: 39, p: 0.9, c: 9.5, f: 0.3, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} medium peach} =0.5 {{1} medium peach} =0.75 {{1} medium peach} one {{1} medium peach} other {{1} medium peaches}}'), g: 150, step: 0.5 }], min: 75, max: 450, portion: 225 },
  { id: 'pineapple', name: tr('Pineapple'), aliases: [tr('Pineapple'), ...trl('fruit')], role: 'fruit', kcal: 50, p: 0.5, c: 13, f: 0.1, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(165)], min: 80, max: 330, portion: 165 },
  { id: 'plums', name: tr('Plums'), aliases: [...trl('plum'), tr('Plums'), ...trl('fruit')], role: 'fruit', kcal: 46, p: 0.7, c: 11.4, f: 0.3, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} plum} =0.5 {{1} plum} =0.75 {{1} plum} one {{1} plum} other {{1} plums}}'), g: 65, step: 1 }], min: 65, max: 325, portion: 195, discrete: true },
  { id: 'pomegranate', name: tr('Pomegranate seeds'), aliases: [...trl('pomegranate'), ...trl('fruit')], role: 'fruit', kcal: 83, p: 1.7, c: 18.7, f: 1.2, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(170)], min: 60, max: 260, portion: 130 },
  { id: 'clementine', name: tr('Clementines'), aliases: [...trl('clementine'), ...trl('mandarin'), ...trl('citrus'), ...trl('fruit')], role: 'fruit', kcal: 47, p: 0.9, c: 12, f: 0.2, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} clementine} =0.5 {{1} clementine} =0.75 {{1} clementine} one {{1} clementine} other {{1} clementines}}'), g: 75, step: 1 }], min: 75, max: 300, portion: 150, discrete: true },
  { id: 'strawberries', name: tr('Strawberries'), aliases: [...trl('strawberry'), tr('Strawberries'), ...trl('fruit')], role: 'fruit', kcal: 32, p: 0.7, c: 7.7, f: 0.3, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(150)], min: 100, max: 450, portion: 225 },
  { id: 'persimmon', name: tr('Persimmon'), aliases: [tr('Persimmon'), ...trl('sharon fruit'), ...trl('fruit')], role: 'fruit', kcal: 70, p: 0.6, c: 18.6, f: 0.2, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} medium persimmon} =0.5 {{1} medium persimmon} =0.75 {{1} medium persimmon} one {{1} medium persimmon} other {{1} medium persimmons}}'), g: 170, step: 0.5 }], min: 85, max: 340, portion: 170 },
  { id: 'figs', name: tr('Fresh figs'), aliases: [...trl('fig'), ...trl('figs'), ...trl('fruit')], role: 'fruit', kcal: 74, p: 0.8, c: 19.2, f: 0.3, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} fig} =0.5 {{1} fig} =0.75 {{1} fig} one {{1} fig} other {{1} figs}}'), g: 50, step: 1 }], min: 50, max: 250, portion: 100, discrete: true },
  { id: 'apricot', name: tr('Apricot'), aliases: [tr('Apricot'), ...trl('apricots'), ...trl('fruit')], role: 'fruit', kcal: 48, p: 1.4, c: 11.1, f: 0.4, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} apricot} =0.5 {{1} apricot} =0.75 {{1} apricot} one {{1} apricot} other {{1} apricots}}'), g: 35, step: 1 }], min: 70, max: 350, portion: 140, discrete: true },
  { id: 'cherries', name: tr('Cherries'), aliases: [...trl('cherry'), tr('Cherries'), ...trl('fruit')], role: 'fruit', kcal: 63, p: 1.1, c: 16, f: 0.2, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(140)], min: 70, max: 280, portion: 140 },
  { id: 'nectarine', name: tr('Nectarine'), aliases: [tr('Nectarine'), ...trl('fruit')], role: 'fruit', kcal: 44, p: 1.1, c: 10.6, f: 0.3, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} medium nectarine} =0.5 {{1} medium nectarine} =0.75 {{1} medium nectarine} one {{1} medium nectarine} other {{1} medium nectarines}}'), g: 140, step: 0.5 }], min: 70, max: 420, portion: 210 },
  { id: 'grapefruit', name: tr('Grapefruit'), aliases: [tr('Grapefruit'), ...trl('citrus'), ...trl('fruit')], role: 'fruit', kcal: 42, p: 0.8, c: 10.7, f: 0.1, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} grapefruit half} =0.5 {{1} grapefruit half} =0.75 {{1} grapefruit half} one {{1} grapefruit half} other {{1} grapefruit halves}}'), g: 125, step: 1 }], min: 125, max: 500, portion: 250 },
  { id: 'pomelo', name: tr('Pomelo'), aliases: [tr('Pomelo'), ...trl('sweetie'), ...trl('citrus'), ...trl('fruit')], role: 'fruit', kcal: 38, p: 0.8, c: 9.6, f: 0.04, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(190)], min: 95, max: 380, portion: 190 },
  { id: 'lychee', name: tr('Lychee'), aliases: [...trl('lychee'), tr('Lychee'), ...trl('fruit')], role: 'fruit', kcal: 66, p: 0.8, c: 16.5, f: 0.4, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} lychee} =0.5 {{1} lychee} =0.75 {{1} lychee} one {{1} lychee} other {{1} lychees}}'), g: 10, step: 1 }], min: 50, max: 200, portion: 100, discrete: true },
  { id: 'passion_fruit', name: tr('Passion fruit'), aliases: [tr('Passion fruit'), ...trl('fruit')], role: 'fruit', kcal: 97, p: 2.2, c: 23.4, f: 0.7, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} passion fruit (pulp)} =0.5 {{1} passion fruit (pulp)} =0.75 {{1} passion fruit (pulp)} one {{1} passion fruit (pulp)} other {{1} passion fruits (pulp)}}'), g: 18, step: 1 }], min: 18, max: 108, portion: 54, discrete: true },
  { id: 'guava', name: tr('Guava'), aliases: [tr('Guava'), ...trl('fruit')], role: 'fruit', kcal: 68, p: 2.6, c: 14.3, f: 1, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} guava} =0.5 {{1} guava} =0.75 {{1} guava} one {{1} guava} other {{1} guavas}}'), g: 55, step: 1 }], min: 55, max: 275, portion: 110, discrete: true },
  { id: 'papaya', name: tr('Papaya'), aliases: [tr('Papaya'), ...trl('fruit')], role: 'fruit', kcal: 43, p: 0.5, c: 10.8, f: 0.3, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(145)], min: 70, max: 290, portion: 145 },
  { id: 'blueberries', name: tr('Blueberries'), aliases: [tr('Blueberries'), tr('Berries'), ...trl('fruit')], role: 'fruit', kcal: 57, p: 0.7, c: 14.5, f: 0.3, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(150)], min: 75, max: 300, portion: 150 },
  { id: 'raspberries', name: tr('Raspberries'), aliases: [tr('Raspberries'), tr('Berries'), ...trl('fruit')], role: 'fruit', kcal: 52, p: 1.2, c: 11.9, f: 0.7, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(125)], min: 60, max: 250, portion: 125 },
  { id: 'loquat', name: tr('Loquat'), aliases: [tr('Loquat'), ...trl('fruit')], role: 'fruit', kcal: 47, p: 0.4, c: 12.1, f: 0.2, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} loquat} =0.5 {{1} loquat} =0.75 {{1} loquat} one {{1} loquat} other {{1} loquats}}'), g: 20, step: 1 }], min: 60, max: 300, portion: 140, discrete: true },
  { id: 'raisins', name: tr('Raisins'), aliases: [tr('Raisins'), ...trl('dried fruit'), ...trl('fruit')], role: 'fruit', kcal: 299, p: 3.1, c: 79.2, f: 0.5, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [U.tbsp(10)], min: 10, max: 60, portion: 30 },
  { id: 'dried_apricots', name: tr('Dried apricot'), aliases: [tr('Apricot'), ...trl('dried fruit'), ...trl('fruit')], role: 'fruit', kcal: 241, p: 3.4, c: 62.6, f: 0.5, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} dried apricot} =0.5 {{1} dried apricot} =0.75 {{1} dried apricot} one {{1} dried apricot} other {{1} dried apricots}}'), g: 8, step: 1 }], min: 16, max: 80, portion: 40, discrete: true },
  { id: 'prunes', name: tr('Prunes'), aliases: [...trl('plum'), ...trl('dried fruit'), ...trl('fruit')], role: 'fruit', kcal: 240, p: 2.2, c: 63.9, f: 0.4, meals: 'blds', src: 'plant', kosher: 'parve', allergens: [], units: [{ u: raw('{0, plural, =0.25 {{1} prune} =0.5 {{1} prune} =0.75 {{1} prune} one {{1} prune} other {{1} prunes}}'), g: 10, step: 1 }], min: 20, max: 80, portion: 40, discrete: true },
];

// Spelling variants and translations can repeat a search word: keep each once.
for (const f of FOODS) if (f.aliases) f.aliases = [...new Set(f.aliases)];

export const FOOD_BY_ID = Object.fromEntries(FOODS.map((f) => [f.id, f]));

export const ALLERGENS = [
  { id: 'gluten', label: tr('gluten') },
  { id: 'dairy', label: tr('Dairy / lactose') },
  { id: 'egg', label: tr('Eggs') },
  { id: 'peanut', label: tr('peanuts') },
  { id: 'treenut', label: tr('nuts') },
  { id: 'soy', label: tr('soy') },
  { id: 'fish', label: tr('Fish') },
  { id: 'shellfish', label: tr('seafood') },
  { id: 'sesame', label: tr('sesame') },
];

export const DIETS = [
  { id: 'omni', label: tr('Everything') },
  { id: 'pescatarian', label: tr('Pescatarian (fish, no meat)') },
  { id: 'vegetarian', label: tr('Vegetarian') },
  { id: 'vegan', label: tr('Vegan') },
  { id: 'keto', label: tr('Keto (low carb)') },
  { id: 'carnivore', label: tr('Carnivore (animal products only)') },
];

export const DIET_NOTES = {
  keto: tr('Keto: up to about 50 g of carbs per day (20–30 g net, after fiber), with no bread, grains, legumes or fruit. Most of your energy comes from fat. In the first few days you may feel fatigue and headache ("keto flu"); be sure to drink water and get enough salt.'),
  carnivore: tr('Carnivore: animal foods only — meat, poultry, fish, eggs and dairy. No fruit, vegetables or grains. This is an extreme diet, so consulting a doctor is recommended, especially with high cholesterol or kidney problems.'),
};

export const ROLE_LABEL = { protein: tr('Protein‖role'), carb: tr('Carbs'), fat: tr('Fat'), veg: tr('vegetables'), fruit: tr('fruit') };

export const DIET_ALLOWED_SRC = {
  omni: ['meat', 'poultry', 'fish', 'shellfish', 'dairy', 'egg', 'plant'],
  pescatarian: ['fish', 'shellfish', 'dairy', 'egg', 'plant'],
  vegetarian: ['dairy', 'egg', 'plant'],
  vegan: ['plant'],
  keto: ['meat', 'poultry', 'fish', 'shellfish', 'dairy', 'egg', 'plant'],
  carnivore: ['meat', 'poultry', 'fish', 'shellfish', 'dairy', 'egg'],
};

// Keto keeps protein, fat and low-carb vegetables; these are too starchy.
const KETO_EXCLUDE = new Set(['lentils', 'chickpeas', 'black_beans', 'white_beans', 'cashews', 'pistachios', 'carrot', 'corn', 'beets', 'pumpkin', 'hummus_spread']);

// The categories a diet's menus actually use.
export function dietRoles(diet) {
  if (diet === 'keto') return ['protein', 'fat', 'veg'];
  if (diet === 'carnivore') return ['protein', 'fat'];
  return ['protein', 'carb', 'fat', 'veg', 'fruit'];
}

function norm(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[׳'"״`’]/g, '').replace(/\s+/g, ' ').trim();
}

// Splits the free-text "foods I don't eat" field into terms.
export function parseDislikes(text) {
  return String(text || '')
    .split(/[,،\n;]+/)
    .map((t) => norm(t))
    .filter((t) => t.length >= 2);
}

export function dislikeMatches(food, terms) {
  if (!terms.length) return false;
  const hay = [food.name, ...(food.aliases || [])].map(norm);
  return terms.some((t) => hay.some((x) => x.includes(t) || (t.length >= 3 && t.includes(x) && x.length >= 3)));
}

// The single source of truth for "may this user be served this food?".
// Used by the meal generator, the local substitution engine, and (as a list of
// allowed/excluded foods) by the assistant's context, so the three can never disagree.
export function isAllowed(food, prefs) {
  const diet = prefs.diet || 'omni';
  if (!DIET_ALLOWED_SRC[diet].includes(food.src)) return false;
  if (!dietRoles(diet).includes(food.role)) return false;
  if (diet === 'keto' && KETO_EXCLUDE.has(food.id)) return false;
  if (prefs.kosher && food.nonKosher) return false;
  const allergies = prefs.allergies || [];
  if (food.allergens.some((a) => allergies.includes(a))) return false;
  if ((prefs.excluded || []).includes(food.id)) return false;
  if (dislikeMatches(food, parseDislikes(prefs.dislikes))) return false;
  return true;
}

// Every role must keep at least this many foods, so every menu item always
// has a substitute. The food picker refuses to exclude below it.
export const MIN_PER_ROLE = 2;
export const ROLES = ['protein', 'carb', 'fat', 'veg', 'fruit'];

export function countByRole(prefs) {
  const out = Object.fromEntries(ROLES.map((r) => [r, 0]));
  for (const f of FOODS) if (isAllowed(f, prefs)) out[f.role] += 1;
  return out;
}

// Can this food be excluded without leaving its role short of substitutes?
export function canExclude(foodId, prefs) {
  const food = FOOD_BY_ID[foodId];
  if (!food) return false;
  if (!isAllowed(food, prefs)) return true;
  if (!dietRoles(prefs.diet || 'omni').includes(food.role)) return true;
  return countByRole(prefs)[food.role] - 1 >= MIN_PER_ROLE;
}

export function allowedFoods(prefs) {
  return FOODS.filter((f) => isAllowed(f, prefs));
}

// Kosher: meat and dairy never share a meal.
export function kosherCompatible(food, mealFoods) {
  if (food.kosher === 'parve') return true;
  const clash = food.kosher === 'meat' ? 'dairy' : 'meat';
  return !mealFoods.some((f) => f && f.kosher === clash);
}

export function macrosFor(food, grams) {
  const k = grams / 100;
  return { kcal: food.kcal * k, p: food.p * k, c: food.c * k, f: food.f * k };
}

const FRACTIONS = [[0.25, '¼'], [0.5, '½'], [0.75, '¾']];

// "150 ג׳" -> "≈ ¾ כוס" / "2 ביצים (L)". Picks the largest unit that reads naturally.
export function household(food, grams) {
  if (!food.units || !food.units.length) return '';
  let unit = food.units[food.units.length - 1];
  for (const u of food.units) {
    if (grams / u.g >= 0.75) { unit = u; break; }
  }
  const step = unit.step || 0.5;
  let q = Math.round(grams / unit.g / step) * step;
  if (q <= 0) q = step;
  const whole = Math.floor(q + 1e-9);
  const frac = q - whole;
  const fracSym = (FRACTIONS.find(([v]) => Math.abs(v - frac) < 0.01) || [0, ''])[1];
  const qty = whole === 0 ? fracSym : `${whole}${fracSym}`;
  // The unit's message carries its own plural rules and where the number goes.
  return format(unit.u, [q, qty]);
}
