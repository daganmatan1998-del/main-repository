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
  tsp: { s: 'כפית', p: 'כפיות', g: 5, step: 0.5 },
  tbsp: (g) => ({ s: 'כף', p: 'כפות', g, step: 0.5 }),
  cup: (g) => ({ s: 'כוס', p: 'כוסות', g, step: 0.25 }),
  palm: (g) => ({ s: 'נתח בגודל כף יד', p: 'נתחים בגודל כף יד', g, step: 0.5 }),
};

export const FOODS = [
  // ---------------- proteins ----------------
  { id: 'chicken_breast', name: 'חזה עוף צלוי', aliases: ['עוף', 'חזה עוף', 'פרגית'], role: 'protein', kcal: 165, p: 31, c: 0, f: 3.6, meals: 'ld', src: 'poultry', kosher: 'meat', allergens: [], units: [U.palm(120)], min: 80, max: 320 },
  { id: 'turkey_breast', name: 'חזה הודו צלוי', aliases: ['הודו'], role: 'protein', kcal: 135, p: 30, c: 0, f: 1, meals: 'ld', src: 'poultry', kosher: 'meat', allergens: [], units: [U.palm(120)], min: 80, max: 320 },
  { id: 'chicken_thigh', name: 'פרגית צלויה (ללא עור)', aliases: ['פרגית', 'עוף'], role: 'protein', kcal: 209, p: 26, c: 0, f: 10.9, meals: 'ld', src: 'poultry', kosher: 'meat', allergens: [], units: [U.palm(110)], min: 80, max: 300 },
  { id: 'lean_beef', name: 'בקר רזה טחון 5% מבושל', aliases: ['בקר', 'בשר', 'בשר טחון'], role: 'protein', kcal: 170, p: 26, c: 0, f: 7, meals: 'ld', src: 'meat', kosher: 'meat', allergens: [], units: [U.palm(120)], min: 80, max: 300 },
  { id: 'salmon', name: 'סלמון אפוי', aliases: ['סלמון', 'דג'], role: 'protein', kcal: 206, p: 22, c: 0, f: 12, meals: 'ld', src: 'fish', kosher: 'parve', allergens: ['fish'], units: [U.palm(120)], min: 80, max: 260 },
  { id: 'white_fish', name: 'דג לבן אפוי (אמנון/מושט)', aliases: ['אמנון', 'מושט', 'דג', 'דניס'], role: 'protein', kcal: 128, p: 26, c: 0, f: 2.7, meals: 'ld', src: 'fish', kosher: 'parve', allergens: ['fish'], units: [U.palm(130)], min: 100, max: 320 },
  { id: 'tuna', name: 'טונה במים (מסוננת)', aliases: ['טונה', 'דג'], role: 'protein', kcal: 116, p: 26, c: 0, f: 1, meals: 'blds', src: 'fish', kosher: 'parve', allergens: ['fish'], units: [{ s: 'קופסה מסוננת', p: 'קופסאות מסוננות', g: 112, step: 0.5 }], min: 56, max: 224 },
  { id: 'shrimp', name: 'שרימפס מבושל', aliases: ['שרימפס', 'פירות ים'], role: 'protein', kcal: 99, p: 24, c: 0.2, f: 0.3, meals: 'ld', src: 'shellfish', kosher: 'parve', nonKosher: true, allergens: ['shellfish'], units: [U.cup(140)], min: 100, max: 300 },
  { id: 'eggs', name: 'ביצים', aliases: ['ביצה', 'חביתה', 'ביצים'], role: 'protein', kcal: 143, p: 12.6, c: 0.7, f: 9.5, meals: 'bld', src: 'egg', kosher: 'parve', allergens: ['egg'], units: [{ s: 'ביצה (L)', p: 'ביצים (L)', g: 55, step: 1 }], min: 55, max: 220, discrete: true },
  { id: 'egg_whites', name: 'חלבוני ביצה', aliases: ['חלבון', 'ביצה'], role: 'protein', kcal: 52, p: 11, c: 0.7, f: 0.2, meals: 'b', src: 'egg', kosher: 'parve', allergens: ['egg'], units: [{ s: 'חלבון', p: 'חלבונים', g: 33, step: 1 }], min: 66, max: 264, discrete: true },
  { id: 'cottage', name: "קוטג' 5%", aliases: ['קוטג', "קוטג'", 'גבינה'], role: 'protein', kcal: 94, p: 11, c: 3, f: 5, meals: 'bsd', src: 'dairy', kosher: 'dairy', allergens: ['dairy'], units: [{ s: 'גביע (250 ג׳)', p: 'גביעים (250 ג׳)', g: 250, step: 0.25 }, U.tbsp(25)], min: 100, max: 300 },
  { id: 'white_cheese', name: 'גבינה לבנה 5%', aliases: ['גבינה לבנה', 'גבינה'], role: 'protein', kcal: 98, p: 9, c: 3.5, f: 5, meals: 'bsd', src: 'dairy', kosher: 'dairy', allergens: ['dairy'], units: [U.tbsp(30)], min: 60, max: 250 },
  { id: 'greek_yogurt', name: 'יוגורט חלבון / יווני 0%', aliases: ['יוגורט', 'מעדן חלבון'], role: 'protein', kcal: 59, p: 10, c: 3.6, f: 0.4, meals: 'bs', src: 'dairy', kosher: 'dairy', allergens: ['dairy'], units: [{ s: 'גביע (200 ג׳)', p: 'גביעים (200 ג׳)', g: 200, step: 0.5 }], min: 150, max: 400 },
  { id: 'whey', name: 'אבקת חלבון (מי גבינה)', aliases: ['אבקת חלבון', 'שייק חלבון', 'וויי'], role: 'protein', kcal: 380, p: 78, c: 8, f: 5, meals: 'bs', src: 'dairy', kosher: 'dairy', allergens: ['dairy'], units: [{ s: 'סקופ', p: 'סקופים', g: 30, step: 0.5 }], min: 15, max: 60 },
  { id: 'pea_protein', name: 'אבקת חלבון צמחית (אפונה)', aliases: ['אבקת חלבון', 'חלבון צמחי'], role: 'protein', kcal: 380, p: 75, c: 6, f: 7, meals: 'bs', src: 'plant', kosher: 'parve', allergens: [], units: [{ s: 'סקופ', p: 'סקופים', g: 30, step: 0.5 }], min: 15, max: 60 },
  { id: 'tofu', name: 'טופו קשה', aliases: ['טופו', 'סויה'], role: 'protein', kcal: 144, p: 15.6, c: 2.8, f: 8.7, meals: 'bld', src: 'plant', kosher: 'parve', allergens: ['soy'], units: [{ s: 'קוביה (100 ג׳)', p: 'קוביות (100 ג׳)', g: 100, step: 0.5 }], min: 100, max: 350 },
  { id: 'tempeh', name: 'טמפה', aliases: ['טמפה', 'סויה'], role: 'protein', kcal: 192, p: 20, c: 7.6, f: 10.8, meals: 'ld', src: 'plant', kosher: 'parve', allergens: ['soy'], units: [U.palm(100)], min: 80, max: 250 },
  { id: 'lentils', name: 'עדשים ירוקות מבושלות', aliases: ['עדשים', 'קטניות'], role: 'protein', kcal: 116, p: 9, c: 20, f: 0.4, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(200)], min: 120, max: 400 },
  { id: 'chickpeas', name: 'גרגרי חומוס מבושלים', aliases: ['חומוס', 'קטניות', 'גרגרי חומוס'], role: 'protein', kcal: 164, p: 8.9, c: 27, f: 2.6, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(165)], min: 100, max: 330 },
  { id: 'edamame', name: 'אדממה (פולי סויה)', aliases: ['אדממה', 'סויה'], role: 'protein', kcal: 121, p: 11.9, c: 8.9, f: 5.2, meals: 'lds', src: 'plant', kosher: 'parve', allergens: ['soy'], units: [U.cup(155)], min: 100, max: 300 },
  { id: 'turkey_pastrami', name: 'פסטרמה הודו', aliases: ['פסטרמה', 'הודו', 'נקניק'], role: 'protein', kcal: 110, p: 20, c: 2, f: 2, meals: 'bls', src: 'poultry', kosher: 'meat', allergens: [], units: [{ s: 'פרוסה', p: 'פרוסות', g: 15, step: 1 }], min: 45, max: 200, discrete: true },
  { id: 'sardines', name: 'סרדינים בשמן (מסוננים)', aliases: ['סרדינים', 'דג'], role: 'protein', kcal: 208, p: 25, c: 0, f: 11, meals: 'bls', src: 'fish', kosher: 'parve', allergens: ['fish'], units: [{ s: 'קופסה מסוננת', p: 'קופסאות מסוננות', g: 90, step: 0.5 }], min: 45, max: 180 },
  { id: 'yellow_cheese', name: 'גבינה צהובה 9%', aliases: ['גבינה צהובה', 'גבינה'], role: 'protein', kcal: 205, p: 30, c: 1, f: 9, meals: 'bsd', src: 'dairy', kosher: 'dairy', allergens: ['dairy'], units: [{ s: 'פרוסה', p: 'פרוסות', g: 20, step: 1 }], min: 20, max: 120, discrete: true },
  { id: 'labane', name: 'לבנה 5%', aliases: ['לבנה', 'גבינה'], role: 'protein', kcal: 90, p: 6, c: 4, f: 5, meals: 'bsd', src: 'dairy', kosher: 'dairy', allergens: ['dairy'], units: [U.tbsp(25)], min: 50, max: 250 },
  { id: 'seitan', name: 'סייטן', aliases: ['סייטן', 'גלוטן'], role: 'protein', kcal: 130, p: 25, c: 4, f: 2, meals: 'ld', src: 'plant', kosher: 'parve', allergens: ['gluten'], units: [U.palm(100)], min: 80, max: 250 },
  { id: 'black_beans', name: 'שעועית שחורה מבושלת', aliases: ['שעועית', 'קטניות'], role: 'protein', kcal: 132, p: 8.9, c: 23.7, f: 0.5, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(170)], min: 120, max: 400 },
  { id: 'entrecote', name: 'אנטריקוט צלוי', aliases: ['אנטריקוט', 'סטייק', 'בקר', 'בשר'], role: 'protein', kcal: 291, p: 24, c: 0, f: 22, meals: 'ld', src: 'meat', kosher: 'meat', allergens: [], units: [U.palm(130)], min: 100, max: 300 },
  { id: 'beef_20', name: 'בקר טחון 20% מבושל', aliases: ['בקר', 'בשר', 'בשר טחון', 'קציצות'], role: 'protein', kcal: 254, p: 26, c: 0, f: 17, meals: 'ld', src: 'meat', kosher: 'meat', allergens: [], units: [U.palm(120)], min: 80, max: 300 },

  // ---------------- carbs ----------------
  { id: 'white_rice', name: 'אורז לבן מבושל', aliases: ['אורז'], role: 'carb', kcal: 130, p: 2.7, c: 28, f: 0.3, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(160), U.tbsp(15)], min: 60, max: 400 },
  { id: 'brown_rice', name: 'אורז מלא מבושל', aliases: ['אורז'], role: 'carb', kcal: 123, p: 2.7, c: 25.6, f: 1, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(160), U.tbsp(15)], min: 60, max: 400 },
  { id: 'quinoa', name: 'קינואה מבושלת', aliases: ['קינואה'], role: 'carb', kcal: 120, p: 4.4, c: 21.3, f: 1.9, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(170), U.tbsp(15)], min: 60, max: 400 },
  { id: 'pasta', name: 'פסטה מבושלת', aliases: ['פסטה', 'ספגטי'], role: 'carb', kcal: 158, p: 5.8, c: 31, f: 0.9, meals: 'ld', src: 'plant', kosher: 'parve', allergens: ['gluten'], units: [U.cup(140)], min: 60, max: 400 },
  { id: 'sweet_potato', name: 'בטטה אפויה', aliases: ['בטטה'], role: 'carb', kcal: 90, p: 2, c: 20.7, f: 0.2, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [{ s: 'בטטה בינונית', p: 'בטטות בינוניות', g: 150, step: 0.5 }], min: 80, max: 500 },
  { id: 'potato', name: 'תפוח אדמה מבושל', aliases: ['תפוח אדמה', 'תפוחי אדמה', 'תפו"א'], role: 'carb', kcal: 87, p: 1.9, c: 20, f: 0.1, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [{ s: 'תפוח אדמה בינוני', p: 'תפוחי אדמה בינוניים', g: 150, step: 0.5 }], min: 80, max: 500 },
  { id: 'buckwheat', name: 'כוסמת מבושלת', aliases: ['כוסמת'], role: 'carb', kcal: 92, p: 3.4, c: 20, f: 0.6, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(170), U.tbsp(15)], min: 60, max: 450 },
  { id: 'bulgur', name: 'בורגול מבושל', aliases: ['בורגול'], role: 'carb', kcal: 83, p: 3.1, c: 18.6, f: 0.2, meals: 'ld', src: 'plant', kosher: 'parve', allergens: ['gluten'], units: [U.cup(180), U.tbsp(15)], min: 60, max: 450 },
  { id: 'couscous', name: 'קוסקוס מבושל', aliases: ['קוסקוס'], role: 'carb', kcal: 112, p: 3.8, c: 23, f: 0.2, meals: 'ld', src: 'plant', kosher: 'parve', allergens: ['gluten'], units: [U.cup(157), U.tbsp(15)], min: 60, max: 400 },
  { id: 'wholewheat_bread', name: 'לחם מלא', aliases: ['לחם', 'פרוסה'], role: 'carb', kcal: 247, p: 13, c: 41, f: 3.4, meals: 'bls', src: 'plant', kosher: 'parve', allergens: ['gluten'], units: [{ s: 'פרוסה', p: 'פרוסות', g: 30, step: 1 }], min: 30, max: 150, discrete: true },
  { id: 'pita', name: 'פיתה מקמח מלא', aliases: ['פיתה', 'לחם'], role: 'carb', kcal: 262, p: 9.8, c: 55, f: 2.6, meals: 'l', src: 'plant', kosher: 'parve', allergens: ['gluten'], units: [{ s: 'פיתה', p: 'פיתות', g: 90, step: 0.5 }], min: 45, max: 180, discrete: true },
  { id: 'oats', name: 'שיבולת שועל', aliases: ['קוואקר', 'שיבולת', 'דייסה'], role: 'carb', kcal: 389, p: 16.9, c: 66, f: 6.9, meals: 'bs', src: 'plant', kosher: 'parve', allergens: ['gluten'], units: [{ s: 'חצי כוס', p: 'חצאי כוס', g: 40, step: 0.5 }, U.tbsp(10)], min: 20, max: 120 },
  { id: 'rice_cakes', name: 'פריכיות אורז', aliases: ['פריכיות', 'פריכית'], role: 'carb', kcal: 387, p: 8, c: 81, f: 2.8, meals: 'bs', src: 'plant', kosher: 'parve', allergens: [], units: [{ s: 'פריכית', p: 'פריכיות', g: 9, step: 1 }], min: 18, max: 72, discrete: true },
  { id: 'gf_bread', name: 'לחם ללא גלוטן', aliases: ['לחם'], role: 'carb', kcal: 250, p: 4, c: 46, f: 5, meals: 'bs', src: 'plant', kosher: 'parve', allergens: [], units: [{ s: 'פרוסה', p: 'פרוסות', g: 35, step: 1 }], min: 35, max: 140, discrete: true },
  { id: 'corn', name: 'תירס מתוק', aliases: ['תירס'], role: 'carb', kcal: 96, p: 3.4, c: 21, f: 1.5, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(150)], min: 60, max: 400 },
  { id: 'freekeh', name: 'פריקי מבושל', aliases: ['פריקי', 'פריקה'], role: 'carb', kcal: 125, p: 5, c: 25, f: 0.8, meals: 'ld', src: 'plant', kosher: 'parve', allergens: ['gluten'], units: [U.cup(160), U.tbsp(15)], min: 60, max: 400 },
  { id: 'rye_bread', name: 'לחם שיפון', aliases: ['לחם', 'שיפון', 'פרוסה'], role: 'carb', kcal: 259, p: 9, c: 48, f: 3.3, meals: 'bls', src: 'plant', kosher: 'parve', allergens: ['gluten'], units: [{ s: 'פרוסה', p: 'פרוסות', g: 32, step: 1 }], min: 32, max: 160, discrete: true },
  { id: 'tortilla', name: 'טורטייה מקמח מלא', aliases: ['טורטייה', 'לאפה', 'לחם'], role: 'carb', kcal: 295, p: 9, c: 49, f: 7, meals: 'bl', src: 'plant', kosher: 'parve', allergens: ['gluten'], units: [{ s: 'טורטייה', p: 'טורטיות', g: 45, step: 0.5 }], min: 45, max: 180, discrete: true },

  // ---------------- fats ----------------
  { id: 'olive_oil', name: 'שמן זית', aliases: ['שמן'], role: 'fat', kcal: 884, p: 0, c: 0, f: 100, meals: 'bld', src: 'plant', kosher: 'parve', allergens: [], units: [U.tbsp(14), U.tsp], min: 3, max: 30 },
  { id: 'avocado', name: 'אבוקדו', aliases: ['אבוקדו'], role: 'fat', kcal: 160, p: 2, c: 8.5, f: 14.7, meals: 'bld', src: 'plant', kosher: 'parve', allergens: [], units: [{ s: 'רבע אבוקדו', p: 'רבעי אבוקדו', g: 40, step: 0.5 }], min: 20, max: 160 },
  { id: 'tahini', name: 'טחינה גולמית', aliases: ['טחינה', 'שומשום'], role: 'fat', kcal: 595, p: 17, c: 21, f: 54, meals: 'bld', src: 'plant', kosher: 'parve', allergens: ['sesame'], units: [U.tbsp(15)], min: 8, max: 45 },
  { id: 'almonds', name: 'שקדים', aliases: ['שקדים', 'אגוזים'], role: 'fat', kcal: 579, p: 21, c: 22, f: 50, meals: 'bs', src: 'plant', kosher: 'parve', allergens: ['treenut'], units: [{ s: 'חופן קטן (~10 שקדים)', p: 'חופנים קטנים', g: 12, step: 0.5 }], min: 6, max: 50 },
  { id: 'walnuts', name: 'אגוזי מלך', aliases: ['אגוזים', 'אגוז'], role: 'fat', kcal: 654, p: 15, c: 14, f: 65, meals: 'bs', src: 'plant', kosher: 'parve', allergens: ['treenut'], units: [{ s: 'חצי אגוז', p: 'חצאי אגוז', g: 2.5, step: 1 }], min: 5, max: 40 },
  { id: 'peanut_butter', name: 'חמאת בוטנים טבעית', aliases: ['חמאת בוטנים', 'בוטנים'], role: 'fat', kcal: 588, p: 25, c: 20, f: 50, meals: 'bs', src: 'plant', kosher: 'parve', allergens: ['peanut'], units: [U.tbsp(16), U.tsp], min: 8, max: 40 },
  { id: 'chia', name: "זרעי צ'יה", aliases: ["צ'יה", 'צ׳יה', 'זרעים'], role: 'fat', kcal: 486, p: 17, c: 42, f: 31, meals: 'bs', src: 'plant', kosher: 'parve', allergens: [], units: [U.tbsp(12)], min: 6, max: 36 },
  { id: 'olives', name: 'זיתים', aliases: ['זית', 'זיתים'], role: 'fat', kcal: 115, p: 0.8, c: 6, f: 11, meals: 'bld', src: 'plant', kosher: 'parve', allergens: [], units: [{ s: 'זית', p: 'זיתים', g: 4, step: 1 }], min: 20, max: 60 },
  { id: 'cashews', name: 'קשיו', aliases: ['קשיו', 'אגוזים'], role: 'fat', kcal: 570, p: 18, c: 30, f: 44, meals: 'bs', src: 'plant', kosher: 'parve', allergens: ['treenut'], units: [{ s: 'חופן קטן (~10 קשיו)', p: 'חופנים קטנים', g: 15, step: 0.5 }], min: 8, max: 50 },
  { id: 'flaxseed', name: 'זרעי פשתן טחונים', aliases: ['פשתן', 'זרעים'], role: 'fat', kcal: 534, p: 18, c: 29, f: 42, meals: 'bs', src: 'plant', kosher: 'parve', allergens: [], units: [U.tbsp(10)], min: 5, max: 30 },
  { id: 'pumpkin_seeds', name: 'גרעיני דלעת קלופים', aliases: ['גרעינים', 'דלעת', 'זרעים'], role: 'fat', kcal: 559, p: 30, c: 11, f: 49, meals: 'bsld', src: 'plant', kosher: 'parve', allergens: [], units: [U.tbsp(10)], min: 5, max: 40 },
  { id: 'butter', name: 'חמאה', aliases: ['חמאה'], role: 'fat', kcal: 717, p: 0.9, c: 0.1, f: 81, meals: 'bsd', src: 'dairy', kosher: 'dairy', allergens: ['dairy'], units: [U.tbsp(14), U.tsp], min: 3, max: 30 },
  { id: 'hard_cheese', name: 'גבינה קשה 28% (פרמזן/צ׳דר)', aliases: ['גבינה קשה', 'פרמזן', 'צדר', 'גבינה'], role: 'fat', kcal: 402, p: 25, c: 1.3, f: 33, meals: 'bsd', src: 'dairy', kosher: 'dairy', allergens: ['dairy'], units: [{ s: 'פרוסה', p: 'פרוסות', g: 20, step: 1 }], min: 10, max: 80 },

  // ---------------- vegetables (fixed portion, near-free) ----------------
  { id: 'salad', name: 'סלט ירקות (עגבנייה, מלפפון, פלפל)', aliases: ['סלט', 'ירקות', 'עגבנייה', 'מלפפון', 'פלפל'], role: 'veg', kcal: 20, p: 0.9, c: 4, f: 0.2, meals: 'bld', src: 'plant', kosher: 'parve', allergens: [], units: [{ s: 'קערה בינונית', p: 'קערות בינוניות', g: 200, step: 0.5 }], min: 100, max: 300, portion: 200 },
  { id: 'broccoli', name: 'ברוקולי מאודה', aliases: ['ברוקולי', 'ירקות'], role: 'veg', kcal: 35, p: 2.4, c: 7, f: 0.4, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(155)], min: 100, max: 300, portion: 150 },
  { id: 'green_beans', name: 'שעועית ירוקה מאודה', aliases: ['שעועית', 'ירקות'], role: 'veg', kcal: 35, p: 1.9, c: 7.9, f: 0.3, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(125)], min: 100, max: 300, portion: 150 },
  { id: 'roasted_veg', name: 'ירקות אפויים (קישוא, פלפל, בצל)', aliases: ['קישוא', 'ירקות', 'בצל', 'פלפל'], role: 'veg', kcal: 35, p: 1.2, c: 7, f: 0.3, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(150)], min: 100, max: 300, portion: 180 },
  { id: 'leafy', name: 'סלט עלים ירוקים', aliases: ['חסה', 'עלים', 'ירקות', 'תרד'], role: 'veg', kcal: 20, p: 1.8, c: 3.3, f: 0.3, meals: 'bld', src: 'plant', kosher: 'parve', allergens: [], units: [{ s: 'קערה', p: 'קערות', g: 100, step: 0.5 }], min: 60, max: 200, portion: 120 },
  { id: 'carrot', name: 'גזר', aliases: ['גזר', 'ירקות'], role: 'veg', kcal: 41, p: 0.9, c: 9.6, f: 0.2, meals: 'bls', src: 'plant', kosher: 'parve', allergens: [], units: [{ s: 'גזר בינוני', p: 'גזרים בינוניים', g: 70, step: 0.5 }], min: 70, max: 210, portion: 140 },
  { id: 'spinach', name: 'תרד מאודה', aliases: ['תרד', 'ירקות', 'עלים'], role: 'veg', kcal: 23, p: 2.9, c: 3.6, f: 0.4, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(180)], min: 80, max: 250, portion: 150 },
  { id: 'cauliflower', name: 'כרובית אפויה', aliases: ['כרובית', 'ירקות'], role: 'veg', kcal: 25, p: 1.9, c: 5, f: 0.3, meals: 'ld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(125)], min: 100, max: 300, portion: 160 },
  { id: 'mushrooms', name: 'פטריות מוקפצות', aliases: ['פטריות', 'ירקות'], role: 'veg', kcal: 22, p: 3.1, c: 3.3, f: 0.3, meals: 'bld', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(110)], min: 80, max: 250, portion: 130 },

  // ---------------- fruit ----------------
  { id: 'banana', name: 'בננה', aliases: ['בננה', 'פרי'], role: 'fruit', kcal: 89, p: 1.1, c: 22.8, f: 0.3, meals: 'bs', src: 'plant', kosher: 'parve', allergens: [], units: [{ s: 'בננה בינונית', p: 'בננות בינוניות', g: 120, step: 0.25 }], min: 60, max: 240, portion: 120 },
  { id: 'apple', name: 'תפוח עץ', aliases: ['תפוח', 'פרי'], role: 'fruit', kcal: 52, p: 0.3, c: 13.8, f: 0.2, meals: 'bs', src: 'plant', kosher: 'parve', allergens: [], units: [{ s: 'תפוח בינוני', p: 'תפוחים בינוניים', g: 180, step: 0.25 }], min: 90, max: 360, portion: 180 },
  { id: 'berries', name: 'פירות יער', aliases: ['פירות יער', 'תות', 'פרי'], role: 'fruit', kcal: 50, p: 0.7, c: 12, f: 0.3, meals: 'bs', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(140)], min: 70, max: 300, portion: 140 },
  { id: 'orange', name: 'תפוז', aliases: ['תפוז', 'הדרים', 'פרי'], role: 'fruit', kcal: 47, p: 0.9, c: 11.8, f: 0.1, meals: 'bs', src: 'plant', kosher: 'parve', allergens: [], units: [{ s: 'תפוז בינוני', p: 'תפוזים בינוניים', g: 160, step: 0.25 }], min: 80, max: 320, portion: 160 },
  { id: 'dates', name: "תמרי מג'הול", aliases: ['תמר', 'תמרים', 'פרי'], role: 'fruit', kcal: 282, p: 2.5, c: 75, f: 0.4, meals: 's', src: 'plant', kosher: 'parve', allergens: [], units: [{ s: 'תמר', p: 'תמרים', g: 24, step: 1 }], min: 24, max: 96, portion: 48, discrete: true },
  { id: 'grapes', name: 'ענבים', aliases: ['ענבים', 'פרי'], role: 'fruit', kcal: 69, p: 0.7, c: 18, f: 0.2, meals: 'bs', src: 'plant', kosher: 'parve', allergens: [], units: [U.cup(150)], min: 75, max: 300, portion: 150 },
  { id: 'pear', name: 'אגס', aliases: ['אגס', 'פרי'], role: 'fruit', kcal: 57, p: 0.4, c: 15, f: 0.1, meals: 'bs', src: 'plant', kosher: 'parve', allergens: [], units: [{ s: 'אגס בינוני', p: 'אגסים בינוניים', g: 170, step: 0.25 }], min: 85, max: 340, portion: 170 },
  { id: 'kiwi', name: 'קיווי', aliases: ['קיווי', 'פרי'], role: 'fruit', kcal: 61, p: 1.1, c: 15, f: 0.5, meals: 'bs', src: 'plant', kosher: 'parve', allergens: [], units: [{ s: 'קיווי', p: 'קיווים', g: 75, step: 1 }], min: 75, max: 300, portion: 150, discrete: true },
];

export const FOOD_BY_ID = Object.fromEntries(FOODS.map((f) => [f.id, f]));

export const ALLERGENS = [
  { id: 'gluten', label: 'גלוטן' },
  { id: 'dairy', label: 'חלב / לקטוז' },
  { id: 'egg', label: 'ביצים' },
  { id: 'peanut', label: 'בוטנים' },
  { id: 'treenut', label: 'אגוזים' },
  { id: 'soy', label: 'סויה' },
  { id: 'fish', label: 'דגים' },
  { id: 'shellfish', label: 'פירות ים' },
  { id: 'sesame', label: 'שומשום' },
];

export const DIETS = [
  { id: 'omni', label: 'הכול' },
  { id: 'pescatarian', label: 'פסקטריאני (דגים, בלי בשר)' },
  { id: 'vegetarian', label: 'צמחוני' },
  { id: 'vegan', label: 'טבעוני' },
  { id: 'keto', label: 'קיטו (דל פחמימות)' },
  { id: 'carnivore', label: 'קרניבור (מן החי בלבד)' },
];

export const DIET_NOTES = {
  keto: 'קיטו: עד כ-50 ג׳ פחמימות ביום (20–30 ג׳ נטו, אחרי סיבים) — בלי לחם, דגנים, קטניות ופירות. רוב האנרגיה משומן. בימים הראשונים ייתכנו עייפות וכאב ראש ("שפעת קיטו"); הקפידו על מים ומלח.',
  carnivore: 'קרניבור: רק מזון מן החי — בשר, עוף, דגים, ביצים ומוצרי חלב. בלי פירות, ירקות ודגנים. תפריט קיצוני: מומלץ להתייעץ עם רופא/ה, במיוחד עם כולסטרול גבוה או בעיה בכליות.',
};

export const ROLE_LABEL = { protein: 'חלבון', carb: 'פחמימה', fat: 'שומן', veg: 'ירקות', fruit: 'פרי' };

const DIET_ALLOWED_SRC = {
  omni: ['meat', 'poultry', 'fish', 'shellfish', 'dairy', 'egg', 'plant'],
  pescatarian: ['fish', 'shellfish', 'dairy', 'egg', 'plant'],
  vegetarian: ['dairy', 'egg', 'plant'],
  vegan: ['plant'],
  keto: ['meat', 'poultry', 'fish', 'shellfish', 'dairy', 'egg', 'plant'],
  carnivore: ['meat', 'poultry', 'fish', 'shellfish', 'dairy', 'egg'],
};

// Keto keeps protein, fat and low-carb vegetables; these are too starchy.
const KETO_EXCLUDE = new Set(['lentils', 'chickpeas', 'black_beans', 'cashews', 'carrot', 'corn']);

// The categories a diet's menus actually use.
export function dietRoles(diet) {
  if (diet === 'keto') return ['protein', 'fat', 'veg'];
  if (diet === 'carnivore') return ['protein', 'fat'];
  return ['protein', 'carb', 'fat', 'veg', 'fruit'];
}

function norm(s) {
  return String(s).toLowerCase().replace(/[׳'"״`]/g, '').replace(/\s+/g, ' ').trim();
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
  const label = q > 1 ? unit.p : unit.s;
  return `${qty} ${label}`;
}
