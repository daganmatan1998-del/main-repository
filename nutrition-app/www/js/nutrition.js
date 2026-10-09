// Nutrition engine: energy expenditure, safe goal pacing, calories and macros.
// Pure functions only — no DOM, no storage — so they run under Node tests as-is.

import { round, clamp, daysBetween, dayKey } from './util.js';

export const KCAL_PER_KG = 7700;

// Daily-life activity outside of workouts. Workouts are added separately below,
// which avoids the usual double-counting of "moderately active" multipliers.
export const ACTIVITY = {
  sedentary: { label: 'יושבני', hint: 'עבודה משרדית, מעט הליכה', f: 1.2 },
  light: { label: 'פעיל קל', hint: 'הרבה עמידה/הליכה, 7–10 אלף צעדים', f: 1.3 },
  active: { label: 'פעיל', hint: 'עבודה בתנועה, מעל 10 אלף צעדים', f: 1.4 },
  very: { label: 'פעיל מאוד', hint: 'עבודה פיזית קשה', f: 1.5 },
};
const PER_WORKOUT = 0.035; // multiplier added per weekly workout (~45–60 min)

export const GOALS = {
  cut: { label: 'חיטוב', sub: 'ירידה בשומן', icon: '↘' },
  maintain: { label: 'שמירה', sub: 'שמירה על המשקל', icon: '→' },
  bulk: { label: 'מסה', sub: 'עלייה במסת שריר', icon: '↗' },
};

// Safety limits.
export const LIMITS = {
  cutMaxPctPerWeek: 1.0, // % body weight per week
  cutRecommendedPct: 0.7,
  bulkMaxPctPerWeek: 0.5,
  bulkRecommendedPct: 0.3,
  maxDeficitFraction: 0.3, // never below 70% of TDEE
  maxSurplus: 500,
  minCalories: { male: 1500, female: 1200 },
  minBmi: 18.5,
  minBf: { male: 6, female: 14 },
  maxBf: 60,
};

export function bmrMifflin({ sex, age, height, weight }) {
  return 10 * weight + 6.25 * height - 5 * age + (sex === 'female' ? -161 : 5);
}

export function bmrKatch(weight, bf) {
  return 370 + 21.6 * weight * (1 - bf / 100);
}

export function validBf(bf) {
  return typeof bf === 'number' && Number.isFinite(bf) && bf >= 3 && bf <= LIMITS.maxBf;
}

export function energy(profile, weight, bf) {
  const useKatch = validBf(bf);
  const bmr = useKatch ? bmrKatch(weight, bf) : bmrMifflin({ ...profile, weight });
  const workouts = clamp(Number(profile.workouts) || 0, 0, 14);
  const multiplier = (ACTIVITY[profile.activity]?.f || 1.2) + Math.min(workouts, 10) * PER_WORKOUT;
  return {
    bmr: Math.round(bmr),
    method: useKatch ? 'Katch-McArdle' : 'Mifflin-St Jeor',
    multiplier: Number(multiplier.toFixed(3)),
    tdee: Math.round(bmr * multiplier),
  };
}

function bmi(weight, heightCm) {
  const m = heightCm / 100;
  return weight / (m * m);
}

// Expected body fat at the end, given how weight change usually partitions:
// a well-run cut loses ~75% fat, a lean bulk gains ~50% fat.
export function projectBf(goal, weight, bf, targetWeight) {
  if (!validBf(bf)) return null;
  const fat = weight * bf / 100;
  const dw = targetWeight - weight;
  let fatChange;
  if (goal === 'cut') fatChange = dw * 0.75;
  else if (goal === 'bulk') fatChange = dw * 0.5;
  else fatChange = dw;
  const endFat = Math.max(0, fat + fatChange);
  return Number(((endFat / targetWeight) * 100).toFixed(1));
}

// Checks a goal for the chosen period. Returns
// { level: 'ok'|'warn'|'error', messages: [], ratePct, suggestion?: {weeks, targetWeight, targetBf} }
export function assessGoal({ goal, weeks, weight, bf, targetWeight, targetBf, sex, height }) {
  const messages = [];
  let level = 'ok';
  const bump = (l) => { if (l === 'error' || (l === 'warn' && level === 'ok')) level = l; };
  const out = { level, messages, ratePct: 0, suggestion: null, projectedBf: null };

  if (!(weeks >= 1) || !(targetWeight > 0)) {
    bump('error');
    messages.push('יש להזין משך תקופה ומשקל יעד.');
    out.level = level;
    return out;
  }

  const dw = targetWeight - weight;
  const ratePct = Math.abs(dw) / weight / weeks * 100;
  out.ratePct = Number(ratePct.toFixed(2));

  if (goal === 'cut' && dw >= 0) {
    bump('error');
    messages.push('במטרת חיטוב משקל היעד צריך להיות נמוך מהמשקל הנוכחי.');
  }
  if (goal === 'bulk' && dw <= 0) {
    bump('error');
    messages.push('במטרת מסה משקל היעד צריך להיות גבוה מהמשקל הנוכחי.');
  }
  if (goal === 'maintain' && Math.abs(dw) / weight > 0.02) {
    bump('warn');
    messages.push(`בשמירה, משקל היעד בדרך כלל קרוב למשקל הנוכחי (±${(weight * 0.02).toFixed(1)} ק״ג). אם המטרה לרדת או לעלות — עדיף לבחור חיטוב או מסה.`);
  }
  if (height && bmi(targetWeight, height) < LIMITS.minBmi) {
    bump('error');
    const minW = LIMITS.minBmi * (height / 100) ** 2;
    messages.push(`משקל היעד נמוך מטווח המשקל התקין (BMI ${LIMITS.minBmi}). המינימום לגובה שלך הוא כ-${minW.toFixed(1)} ק״ג.`);
  }
  if (validBf(targetBf) && targetBf < LIMITS.minBf[sex]) {
    bump('error');
    messages.push(`אחוז שומן יעד של ${targetBf}% נמוך מדי ואינו בריא. המינימום הסביר הוא ${LIMITS.minBf[sex]}%.`);
  }

  if (level !== 'error') {
    let maxPct = null;
    let recPct = null;
    if (goal === 'cut') { maxPct = LIMITS.cutMaxPctPerWeek; recPct = LIMITS.cutRecommendedPct; }
    if (goal === 'bulk') { maxPct = LIMITS.bulkMaxPctPerWeek; recPct = LIMITS.bulkRecommendedPct; }
    if (maxPct && ratePct > maxPct) {
      bump('warn');
      const perWeek = (Math.abs(dw) / weeks).toFixed(2);
      const sugWeeks = Math.ceil(Math.abs(dw) / (weight * recPct / 100));
      const sugTarget = Number((weight + Math.sign(dw) * weight * recPct / 100 * weeks).toFixed(1));
      messages.push(`היעד דורש שינוי של כ-${perWeek} ק״ג בשבוע (${ratePct.toFixed(1)}% ממשקל הגוף), מעל הקצב הבטוח של ${maxPct}% בשבוע. התוכנית תוגבל לקצב בטוח.`);
      out.suggestion = { weeks: sugWeeks, targetWeight: sugTarget };
    }
  }

  if (validBf(bf) && validBf(targetBf) && level !== 'error') {
    const projected = projectBf(goal, weight, bf, targetWeight);
    out.projectedBf = projected;
    const tooAggressive = goal === 'bulk' ? false : targetBf < projected - 2;
    if (tooAggressive) {
      bump('warn');
      messages.push(`בהינתן משקל היעד, אחוז השומן הצפוי בסוף התקופה הוא כ-${projected}%. יעד של ${targetBf}% דורש תקופה ארוכה יותר או משקל יעד נמוך יותר.`);
      if (out.suggestion) out.suggestion.targetBf = projected;
      else out.suggestion = { targetBf: projected };
    }
  }

  out.level = level;
  return out;
}

// The daily targets for "today", given the active period and the latest metrics.
// Re-pacing happens here: the rate is computed from what is left of the period,
// so every new weigh-in automatically adjusts calories.
export function computeTargets(profile, period, current, today = dayKey()) {
  const { weight } = current;
  const bf = validBf(current.bf) ? current.bf : null;
  const e = energy(profile, weight, bf);
  const warnings = [];

  const daysLeft = Math.max(7, daysBetween(today, period.endDate));
  const weeksLeft = daysLeft / 7;
  let requiredKgPerWeek = (period.targetWeight - weight) / weeksLeft;

  let delta = 0; // daily kcal vs TDEE
  let reached = false;
  if (period.goal === 'cut') {
    if (weight <= period.targetWeight) {
      reached = true;
      requiredKgPerWeek = 0;
    } else {
      const maxKg = weight * LIMITS.cutMaxPctPerWeek / 100;
      const kg = Math.min(-requiredKgPerWeek, maxKg);
      let deficit = kg * KCAL_PER_KG / 7;
      const capFraction = e.tdee * LIMITS.maxDeficitFraction;
      // Fat can only supply ~69 kcal per kg of fat mass per day (Alpert 2005).
      const capFat = bf ? weight * bf / 100 * 69 : Infinity;
      if (deficit > capFraction || deficit > capFat) {
        deficit = Math.min(capFraction, capFat);
      }
      delta = -deficit;
    }
  } else if (period.goal === 'bulk') {
    if (weight >= period.targetWeight) {
      reached = true;
      requiredKgPerWeek = 0;
    } else {
      const maxKg = weight * LIMITS.bulkMaxPctPerWeek / 100;
      const kg = Math.min(requiredKgPerWeek, maxKg);
      delta = Math.min(kg * KCAL_PER_KG / 7, LIMITS.maxSurplus);
      delta = Math.max(delta, 150);
    }
  }

  let calories = e.tdee + delta;
  const floor = Math.max(LIMITS.minCalories[profile.sex] || 1200, e.bmr);
  let floorApplied = false;
  if (calories < floor) {
    calories = floor;
    floorApplied = true;
    warnings.push(`הקלוריות הוגבלו לרצפה בטוחה של ${Math.round(floor)} קק״ל.`);
  }
  calories = round(calories, 10);

  const plannedKgPerWeek = ((calories - e.tdee) * 7) / KCAL_PER_KG;
  const capped = !reached && Math.abs(plannedKgPerWeek) + 0.02 < Math.abs(requiredKgPerWeek);
  if (capped) {
    warnings.push(`כדי להגיע ליעד בזמן נדרש קצב של ${Math.abs(requiredKgPerWeek).toFixed(2)} ק״ג בשבוע. התוכנית מוגבלת לקצב בטוח של ${Math.abs(plannedKgPerWeek).toFixed(2)} ק״ג בשבוע.`);
  }
  if (reached) warnings.push('הגעת למשקל היעד של התקופה! הקלוריות הותאמו לשמירה.');

  const m = macros(period.goal, calories, weight, bf);
  return {
    ...e,
    calories,
    ...m,
    deltaKcal: Math.round(calories - e.tdee),
    plannedKgPerWeek: Number(plannedKgPerWeek.toFixed(2)),
    requiredKgPerWeek: Number(requiredKgPerWeek.toFixed(2)),
    weeksLeft: Number(weeksLeft.toFixed(1)),
    capped,
    reached,
    floorApplied,
    warnings,
    water: round(weight * 35 / 1000, 0.25),
  };
}

export function macros(goal, calories, weight, bf) {
  const lbm = bf ? weight * (1 - bf / 100) : weight * 0.8;
  const perLbm = goal === 'cut' ? 2.5 : 2.2;
  let protein = clamp(lbm * perLbm, weight * 1.4, weight * 2.4);
  const fatPct = goal === 'maintain' ? 0.28 : 0.25;
  let fat = Math.max(weight * 0.6, calories * fatPct / 9);
  let carbs = (calories - protein * 4 - fat * 9) / 4;
  if (carbs < 50) {
    fat = Math.max(weight * 0.5, (calories - protein * 4 - 200) / 9);
    carbs = (calories - protein * 4 - fat * 9) / 4;
  }
  if (carbs < 30) {
    protein = Math.max(weight * 1.4, (calories - fat * 9 - 120) / 4);
    carbs = (calories - protein * 4 - fat * 9) / 4;
  }
  protein = round(protein, 5);
  fat = round(fat, 5);
  carbs = Math.max(0, round((calories - protein * 4 - fat * 9) / 4, 5));
  return { protein, carbs, fat };
}

export function nextGoalSuggestions(goal) {
  if (goal === 'cut') return ['maintain', 'bulk'];
  if (goal === 'bulk') return ['maintain', 'cut'];
  return ['bulk', 'cut'];
}
