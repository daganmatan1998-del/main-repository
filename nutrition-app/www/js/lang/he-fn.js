// Hebrew texts that need code rather than a template: Hebrew attaches ב/ל to
// the front of a word and merges with the article ה, and adjectives take the
// gender of the noun they follow.

// "with" + a noun that may carry the article: ב + הפסטרמה -> בפסטרמה.
const bd = (d) => `ב${d.startsWith('ה') ? d.slice(1) : d}`;
// "with" + an amount: ב-2 פרוסות, but בחזה עוף.
const ba = (a) => (/^[\d½¼¾]/.test(a) ? `ב-${a}` : `ב${a}`);

export default {
  'Cook about {0} g of dry {1} according to the package directions (yields {2} g cooked)': (dry, n, grams) =>
    `מבשלים כ-${dry} ג׳ ${n} יבש${n.endsWith('ים') ? 'ים' : n.endsWith('ה') ? 'ה' : ''} לפי ההוראות (יוצא ${grams} ג׳ מבושל)`,
  '{0} with {1} {2}‖sandwich title': (w, p, ph) => `${w} ${p} ${ph}`,
  'Fill the tortilla with {0} and the vegetables': (d) => `ממלאים את הטורטייה ${bd(d)} ובירקות`,
  'Fill with {0} and the vegetables': (d) => `ממלאים ${bd(d)} ובירקות`,
  'Fill {0} with {1} and season with {2}': (c, a, rub) => `ממלאים את ${c} ${ba(a)} ומתבלים ב${rub}`,
  '{2} oatmeal with {0}‖title': (p, ph) => `דייסת שיבולת שועל עם ${p} ${ph}`,
  '{2} overnight oats with {0}‖title': (p, ph) => `שיבולת שועל של לילה עם ${p} ${ph}`,
};
