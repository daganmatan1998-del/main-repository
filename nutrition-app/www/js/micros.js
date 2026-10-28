// Fiber, sugars, sodium and four vitamins/minerals for every food, per 100 g
// as eaten. Typical USDA FoodData Central / Israeli Ministry of Health values
// (packaged snacks and sauces: typical label values), so the totals are
// estimates. Order: [fiber g, sugars g, sodium mg, potassium mg, calcium mg,
// iron mg, vitamin C mg].

import { EVERYDAY_BY_ID } from './everyday.js';

export const KEYS = ['fiber', 'sugar', 'sodium', 'potassium', 'calcium', 'iron', 'vitc'];
// Daily reference values (adult): fiber / potassium / calcium / iron / vit C are
// goals to reach, sugar and sodium are limits not to pass (WHO, EFSA, RDA).
export const REFERENCE = {
  fiber: { value: 28, goal: true, unit: 'g' },
  sugar: { value: 50, goal: false, unit: 'g' },
  sodium: { value: 2300, goal: false, unit: 'mg' },
  potassium: { value: 3500, goal: true, unit: 'mg' },
  calcium: { value: 1000, goal: true, unit: 'mg' },
  iron: { value: 14, goal: true, unit: 'mg' },
  vitc: { value: 90, goal: true, unit: 'mg' },
};

const TABLE = {
  chicken_breast: [0, 0, 74, 256, 15, 1.0, 0],
  turkey_breast: [0, 0, 60, 300, 12, 0.9, 0],
  chicken_thigh: [0, 0, 90, 240, 12, 1.3, 0],
  lean_beef: [0, 0, 72, 318, 18, 2.5, 0],
  salmon: [0, 0, 61, 384, 15, 0.3, 0],
  white_fish: [0, 0, 52, 380, 14, 0.6, 0],
  tuna: [0, 0, 247, 237, 13, 1.4, 0],
  shrimp: [0, 0, 224, 259, 64, 0.5, 0],
  eggs: [0, 0.4, 142, 138, 56, 1.8, 0],
  egg_whites: [0, 0.7, 166, 163, 7, 0.1, 0],
  cottage: [0, 3, 350, 100, 80, 0.1, 0],
  white_cheese: [0, 3.5, 380, 110, 90, 0.1, 0],
  greek_yogurt: [0, 3.6, 40, 160, 110, 0.0, 0],
  whey: [0, 6, 350, 450, 450, 1.0, 0],
  pea_protein: [3.0, 1.0, 900, 150, 100, 10.0, 0],
  tofu: [2.3, 0.6, 14, 237, 350, 2.7, 0.2],
  tempeh: [0, 0, 9, 412, 111, 2.7, 0],
  lentils: [7.9, 1.8, 2, 369, 19, 3.3, 1.5],
  chickpeas: [7.6, 4.8, 7, 291, 49, 2.9, 1.3],
  edamame: [5.2, 2.2, 6, 436, 63, 2.3, 6.1],
  turkey_pastrami: [0.5, 1.0, 1000, 250, 10, 1.0, 0],
  sardines: [0, 0, 505, 397, 382, 2.9, 0],
  yellow_cheese: [0, 0.5, 700, 100, 900, 0.3, 0],
  labane: [0, 4.0, 350, 150, 130, 0.1, 0],
  seitan: [0.6, 0.5, 29, 100, 142, 5.2, 0],
  black_beans: [8.7, 0.3, 1, 355, 27, 2.1, 0],
  entrecote: [0, 0, 60, 300, 12, 2.2, 0],
  beef_20: [0, 0, 66, 290, 20, 2.6, 0],
  ground_chicken: [0, 0, 80, 230, 13, 1.1, 0],
  ground_turkey: [0, 0, 90, 260, 20, 1.4, 0],
  sirloin: [0, 0, 60, 370, 15, 2.2, 0],
  trout: [0, 0, 60, 500, 86, 0.3, 0],
  hake: [0, 0, 70, 420, 20, 0.5, 0],
  bulgarian: [0, 1.0, 1100, 90, 350, 0.2, 0],
  skyr: [0, 4.0, 50, 160, 120, 0.0, 0],
  pro_pudding: [0.5, 5.0, 80, 170, 110, 0.2, 0],
  soy_chunks: [3.5, 2.0, 5, 400, 60, 2.5, 0],
  white_beans: [6.3, 0.3, 6, 561, 90, 3.7, 0],
  white_rice: [0.4, 0.1, 1, 35, 10, 0.2, 0],
  brown_rice: [1.6, 0.2, 4, 86, 10, 0.6, 0],
  quinoa: [2.8, 0.9, 7, 172, 17, 1.5, 0],
  pasta: [1.8, 0.6, 1, 44, 7, 0.5, 0],
  sweet_potato: [3.3, 6.5, 36, 475, 38, 0.7, 20],
  potato: [1.8, 0.9, 5, 328, 8, 0.3, 7.4],
  buckwheat: [2.7, 0.9, 4, 88, 7, 0.8, 0],
  bulgur: [4.5, 0.1, 5, 68, 10, 1.0, 0],
  couscous: [1.4, 0.1, 5, 58, 8, 0.4, 0],
  wholewheat_bread: [6.0, 5.0, 450, 250, 110, 2.5, 0],
  pita: [7.0, 3.0, 500, 250, 60, 2.5, 0],
  oats: [10.6, 1.0, 2, 429, 54, 4.7, 0],
  rice_cakes: [1.5, 0.5, 30, 120, 10, 0.8, 0],
  gf_bread: [4.0, 4.0, 450, 150, 100, 1.5, 0],
  corn: [2.4, 4.5, 15, 270, 2, 0.5, 6.8],
  freekeh: [4.0, 0.5, 5, 150, 15, 1.2, 0],
  rye_bread: [5.8, 3.9, 660, 166, 73, 2.8, 0],
  tortilla: [6.0, 3.0, 600, 250, 100, 2.5, 0],
  barley: [3.8, 0.3, 3, 93, 11, 1.3, 0],
  millet: [1.3, 0.1, 3, 62, 3, 0.6, 0],
  ptitim: [1.6, 0.6, 5, 50, 10, 0.6, 0],
  whole_pasta: [3.9, 0.8, 3, 44, 21, 1.5, 0],
  gf_pasta: [1.5, 0.5, 5, 50, 5, 0.6, 0],
  rice_noodles: [0.9, 0.1, 6, 12, 3, 0.1, 0],
  green_peas: [5.5, 5.9, 3, 271, 27, 1.5, 14],
  whole_bun: [5.0, 5.0, 500, 250, 100, 2.5, 0],
  crispbread: [10.0, 2.0, 500, 350, 40, 3.0, 0],
  olive_oil: [0, 0, 2, 1, 1, 0.6, 0],
  avocado: [6.7, 0.7, 7, 485, 12, 0.6, 10],
  tahini: [9.3, 0.5, 115, 414, 426, 8.9, 0],
  almonds: [12.5, 4.4, 1, 733, 269, 3.7, 0],
  walnuts: [6.7, 2.6, 2, 441, 98, 2.9, 1.3],
  peanut_butter: [6.0, 9.0, 17, 650, 50, 1.7, 0],
  chia: [34.4, 0, 16, 407, 631, 7.7, 1.6],
  olives: [3.3, 0, 1556, 8, 52, 3.3, 0],
  cashews: [3.3, 5.9, 12, 660, 37, 6.7, 0.5],
  flaxseed: [27.3, 1.6, 30, 813, 255, 5.7, 0.6],
  pumpkin_seeds: [6.0, 1.4, 7, 809, 46, 8.8, 1.9],
  butter: [0, 0.1, 11, 24, 24, 0.0, 0],
  hard_cheese: [0, 0.5, 700, 100, 800, 0.3, 0],
  pistachios: [10.6, 7.7, 1, 1025, 105, 3.9, 5.6],
  hazelnuts: [9.7, 4.3, 0, 680, 114, 4.7, 6.3],
  peanuts: [8.5, 4.0, 6, 705, 92, 4.6, 0],
  sunflower_seeds: [8.6, 2.6, 9, 645, 78, 5.2, 1.4],
  sesame_seeds: [11.8, 0.3, 11, 468, 975, 14.6, 0],
  almond_butter: [10.3, 4.4, 7, 748, 347, 3.5, 0],
  canola_oil: [0, 0, 0, 0, 0, 0.0, 0],
  hummus_spread: [6.0, 0.3, 379, 228, 38, 2.4, 0],
  mozzarella: [0, 1.0, 600, 76, 505, 0.2, 0],
  feta: [0, 1.5, 1100, 60, 360, 0.3, 0],
  cream_cheese: [0, 3.0, 300, 100, 80, 0.2, 0],
  ghee: [0, 0, 2, 5, 4, 0.0, 0],
  salad: [1.2, 2.7, 8, 200, 12, 0.4, 15],
  broccoli: [3.3, 1.4, 41, 293, 40, 0.7, 65],
  green_beans: [3.2, 1.4, 1, 146, 44, 0.8, 9.7],
  roasted_veg: [2.0, 4.0, 10, 230, 20, 0.5, 15],
  leafy: [1.8, 1.0, 25, 250, 40, 0.8, 12],
  carrot: [2.8, 4.7, 69, 320, 33, 0.3, 5.9],
  spinach: [2.4, 0.4, 70, 466, 136, 3.6, 9.8],
  cauliflower: [2.0, 1.9, 30, 299, 22, 0.4, 44],
  mushrooms: [1.0, 1.5, 10, 448, 5, 0.5, 0],
  cucumber: [0.5, 1.7, 2, 147, 16, 0.3, 2.8],
  tomato: [1.2, 2.6, 5, 237, 10, 0.3, 14],
  peppers: [2.0, 4.2, 4, 211, 10, 0.4, 120],
  zucchini: [1.1, 2.5, 3, 261, 15, 0.4, 5.0],
  eggplant: [2.5, 3.2, 5, 230, 6, 0.3, 1.3],
  cabbage: [2.5, 3.2, 18, 170, 40, 0.5, 37],
  asparagus: [2.0, 1.3, 14, 224, 23, 0.9, 7.7],
  brussels: [2.6, 1.9, 25, 389, 36, 1.2, 62],
  pumpkin: [0.5, 2.8, 1, 340, 15, 0.6, 9.0],
  beets: [2.0, 8.0, 77, 305, 16, 0.8, 3.6],
  celery: [1.6, 1.3, 80, 260, 40, 0.2, 3.1],
  radishes: [1.6, 1.9, 39, 233, 25, 0.3, 14.8],
  kohlrabi: [3.6, 2.6, 20, 350, 24, 0.4, 62],
  okra: [2.5, 1.5, 6, 135, 77, 0.3, 13],
  fennel: [3.1, 3.9, 52, 414, 49, 0.7, 12],
  artichoke_hearts: [5.7, 1.0, 94, 286, 21, 0.5, 7.4],
  banana: [2.6, 12.2, 1, 358, 5, 0.3, 8.7],
  apple: [2.4, 10.4, 1, 107, 6, 0.1, 4.6],
  berries: [2.5, 6.0, 1, 150, 20, 0.5, 25],
  orange: [2.4, 9.4, 0, 181, 40, 0.1, 53],
  dates: [6.7, 66.5, 1, 696, 64, 0.9, 0.0],
  grapes: [0.9, 15.5, 2, 191, 10, 0.4, 3.2],
  pear: [3.1, 9.8, 1, 116, 9, 0.2, 4.3],
  kiwi: [3.0, 9.0, 3, 312, 34, 0.3, 93],
  mango: [1.6, 13.7, 1, 168, 11, 0.2, 36],
  watermelon: [0.4, 6.2, 1, 112, 7, 0.2, 8.1],
  melon: [0.9, 7.9, 16, 267, 9, 0.2, 37],
  peach: [1.5, 8.4, 0, 190, 6, 0.3, 6.6],
  pineapple: [1.4, 9.9, 1, 109, 13, 0.3, 48],
  plums: [1.4, 9.9, 0, 157, 6, 0.2, 9.5],
  pomegranate: [4.0, 13.7, 3, 236, 10, 0.3, 10],
  clementine: [1.7, 9.2, 1, 177, 30, 0.1, 49],
  strawberries: [2.0, 4.9, 1, 153, 16, 0.4, 59],
  persimmon: [3.6, 12.5, 1, 161, 8, 0.2, 7.5],
  figs: [2.9, 16.3, 1, 232, 35, 0.4, 2.0],
  apricot: [2.0, 9.2, 1, 259, 13, 0.4, 10],
  cherries: [2.1, 12.8, 0, 222, 13, 0.4, 7.0],
  nectarine: [1.7, 7.9, 0, 201, 6, 0.3, 5.4],
  grapefruit: [1.6, 6.9, 0, 135, 22, 0.1, 31],
  pomelo: [1.0, 8.5, 1, 216, 4, 0.1, 61],
  lychee: [1.3, 15.2, 1, 171, 5, 0.3, 72],
  passion_fruit: [10.4, 11.2, 28, 348, 12, 1.6, 30],
  guava: [5.4, 8.9, 2, 417, 18, 0.3, 228],
  papaya: [1.7, 7.8, 8, 182, 20, 0.3, 61],
  blueberries: [2.4, 10.0, 1, 77, 6, 0.3, 9.7],
  raspberries: [6.5, 4.4, 1, 151, 25, 0.7, 26],
  blackberries: [5.3, 4.9, 1, 162, 29, 0.6, 21],
  dragon_fruit: [3.0, 8.0, 0, 268, 8, 0.7, 3],
  loquat: [1.7, 8.3, 1, 266, 16, 0.3, 1.0],
  raisins: [3.7, 59.2, 11, 749, 50, 1.9, 2.3],
  dried_apricots: [7.3, 53.4, 10, 1162, 55, 3.7, 1.0],
  prunes: [7.1, 38.1, 2, 732, 43, 0.9, 0.6],
  hot_dog: [0.0, 1.5, 1100, 200, 20, 1.0, 0],
  chicken_hot_dog: [0.5, 2.0, 1000, 200, 40, 1.0, 0],
  merguez: [0.5, 0.5, 1000, 250, 20, 1.8, 0],
  salami: [0.0, 0.5, 1740, 378, 10, 1.2, 0],
  schnitzel: [0.8, 0.6, 550, 230, 25, 1.2, 0],
  nuggets: [1.0, 0.9, 550, 250, 20, 1.0, 0],
  fried_chicken: [0.5, 0.3, 500, 260, 20, 1.1, 0],
  shawarma_meat: [0.2, 0.5, 600, 280, 20, 1.8, 0],
  kebab: [0.3, 0.8, 550, 270, 20, 2.0, 0],
  burger: [1.5, 5.0, 450, 200, 70, 2.2, 0.8],
  cheeseburger: [1.4, 5.0, 600, 200, 150, 2.0, 0.8],
  fries: [3.8, 0.5, 210, 579, 15, 0.8, 4.0],
  onion_rings: [2.5, 5.0, 550, 200, 60, 1.5, 1.0],
  pizza: [2.3, 3.6, 598, 172, 200, 2.5, 1.5],
  falafel_ball: [4.9, 1.0, 300, 585, 54, 3.4, 0.8],
  falafel_pita: [3.5, 3.0, 420, 330, 60, 2.0, 5.0],
  shawarma_pita: [1.5, 3.0, 500, 250, 50, 1.8, 3.0],
  burekas: [1.2, 1.5, 550, 150, 100, 1.5, 0],
  malawach: [1.5, 1.5, 420, 100, 30, 1.5, 0],
  toast_cheese: [1.8, 3.0, 650, 150, 250, 1.5, 0],
  sushi: [0.8, 3.5, 330, 100, 10, 0.4, 0.5],
  instant_noodles: [2.5, 2.0, 1700, 200, 40, 3.0, 0],
  shakshuka: [1.2, 3.0, 300, 350, 40, 1.2, 10],
  creamy_pasta: [1.2, 2.0, 320, 120, 60, 0.8, 0],
  pancakes: [1.0, 6.0, 430, 130, 150, 1.5, 0],
  waffle: [1.5, 8.0, 420, 130, 150, 1.8, 0],
  bamba: [2.5, 3.0, 430, 350, 20, 1.5, 0],
  bissli: [3.0, 4.0, 900, 200, 30, 2.0, 0],
  potato_chips: [4.4, 0.5, 525, 1275, 24, 1.5, 20],
  tortilla_chips: [4.5, 1.0, 500, 200, 100, 1.5, 0],
  popcorn: [8.0, 0.5, 600, 300, 10, 2.0, 0],
  pretzels: [3.0, 2.5, 1700, 200, 30, 3.0, 0],
  milk_chocolate: [3.4, 52.0, 79, 372, 189, 2.3, 0],
  dark_chocolate: [10.9, 24.0, 20, 715, 73, 11.9, 0],
  chocolate_spread: [3.0, 50.0, 50, 300, 100, 2.0, 0],
  wafer: [2.0, 38.0, 70, 250, 100, 1.8, 0],
  cookies: [1.5, 30.0, 350, 100, 20, 2.0, 0],
  cake: [1.5, 30.0, 300, 120, 60, 1.5, 0],
  croissant: [2.4, 11.0, 420, 118, 21, 2.1, 0],
  donut: [1.5, 22.0, 350, 100, 40, 1.5, 0],
  ice_cream: [0.7, 21.0, 80, 199, 128, 0.1, 0.6],
  popsicle: [0, 16.0, 10, 20, 5, 0.1, 2.0],
  gummies: [0, 50.0, 40, 10, 10, 0.1, 0],
  halva: [4.0, 35.0, 100, 400, 200, 3.5, 0],
  baklava: [2.5, 20.0, 200, 150, 50, 1.5, 0],
  sweet_cereal: [3.0, 35.0, 500, 150, 100, 6.0, 0],
  granola_bar: [4.0, 30.0, 250, 250, 60, 2.0, 0],
  protein_bar: [5.0, 10.0, 250, 300, 150, 2.0, 0],
  jam: [0.8, 48.0, 20, 50, 10, 0.3, 5.0],
  honey: [0.2, 82.0, 4, 52, 6, 0.4, 0.5],
  sugar: [0, 100.0, 1, 2, 1, 0.0, 0],
  x_mustard: [3.3, 3.0, 1100, 150, 70, 1.5, 0],
  x_lemon: [0.3, 2.5, 1, 103, 6, 0.1, 39],
  x_vinegar: [0, 0.4, 5, 73, 7, 0.2, 0],
  x_diet_dressing: [0.5, 4.0, 900, 50, 10, 0.1, 0],
  x_hot: [1.5, 15.0, 2000, 150, 20, 0.8, 3.0],
  x_soy: [0.8, 0.4, 5500, 212, 17, 1.5, 0],
  x_teriyaki: [0.1, 14.0, 3300, 100, 10, 0.4, 0],
  x_balsamic: [0, 15.0, 23, 112, 27, 0.7, 0],
  x_salsa: [1.9, 5.0, 600, 250, 15, 0.4, 5.0],
  x_marinara: [2.0, 5.5, 500, 300, 20, 0.8, 5.0],
  x_tzatziki: [0.5, 3.0, 250, 150, 100, 0.1, 2.0],
  x_yogurt: [0, 4.7, 46, 155, 121, 0.1, 0.5],
  x_garlic_yogurt: [0.3, 3.5, 250, 150, 100, 0.1, 1.0],
  x_ketchup: [0.3, 22.0, 1000, 380, 15, 0.4, 4.0],
  x_light_mayo: [0.0, 3.0, 800, 15, 8, 0.1, 0],
  x_bbq: [0.5, 34.0, 1000, 250, 20, 0.8, 0.5],
  x_honey_mustard: [0.5, 26.0, 700, 60, 20, 0.5, 0],
  x_sweet_chili: [0.5, 50.0, 900, 50, 10, 0.3, 3.0],
  x_tahini_sauce: [3.0, 1.0, 300, 150, 150, 3.0, 3.0],
  x_hummus: [6.0, 0.3, 400, 228, 38, 2.4, 0],
  x_guacamole: [5.0, 1.0, 300, 400, 15, 0.6, 7.0],
  x_sour_cream: [0, 3.5, 50, 150, 110, 0.1, 0.8],
  x_vinaigrette: [0, 2.5, 800, 10, 5, 0.2, 0],
  x_pesto: [2.0, 2.0, 700, 200, 150, 1.0, 1.0],
  x_mayo: [0, 0.5, 600, 20, 10, 0.2, 0],
  x_olive_oil: [0, 0, 2, 1, 1, 0.6, 0],
};

export const hasMicros = (id) => Object.prototype.hasOwnProperty.call(TABLE, id);

const empty = () => Object.fromEntries(KEYS.map((k) => [k, 0]));

function addFood(sum, id, grams) {
  const row = TABLE[id];
  if (!row || !(grams > 0)) return false;
  KEYS.forEach((k, i) => { sum[k] += (row[i] * grams) / 100; });
  return true;
}

// What one meal contains: plan items, sauces/cheese, and the person's own foods
// (a common food by its table row; a scanned product by the fiber / sugar /
// sodium its label gave). `known` is false when part of the meal has no data
// (a typed food, a photographed meal), so the totals are a lower bound.
export function mealMicros(meal) {
  const sum = empty();
  let known = true;
  if (meal.eaten) return { ...sum, known: false };
  for (const it of meal.items || []) addFood(sum, it.foodId, it.grams);
  for (const e of meal.extras || []) addFood(sum, e.foodId, e.grams);
  for (const c of meal.custom || []) {
    const food = c.ref && EVERYDAY_BY_ID[c.ref];
    if (food) { addFood(sum, food.id, (c.servings || 1) * food.units[0].g); continue; }
    if (c.fi != null || c.su != null || c.na != null) {
      sum.fiber += c.fi || 0; sum.sugar += c.su || 0; sum.sodium += c.na || 0;
    } else known = false;
  }
  return { ...sum, known };
}

// The marked meals of a day added up.
export function dayMicros(meals, eatenIdx) {
  const sum = empty();
  let known = true;
  let any = false;
  for (const m of meals) {
    if (eatenIdx && !eatenIdx.has(m.index)) continue;
    any = true;
    const x = mealMicros(m);
    for (const k of KEYS) sum[k] += x[k];
    if (!x.known) known = false;
  }
  return { ...sum, known, any };
}
