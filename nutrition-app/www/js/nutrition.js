// Nutrition engine: energy expenditure, safe goal pacing, calories and macros.
// Pure functions only — no DOM, no storage — so they run under Node tests as-is.

import { t as tr } from './i18n.js';
import { round, clamp, daysBetween, dayKey } from './util.js';

export const KCAL_PER_KG = 7700;

// Daily-life activity outside of workouts. Workouts are added separately below,
// which avoids the usual double-counting of "moderately active" multipliers.
export const ACTIVITY = {
  sedentary: { label: tr('Sedentary'), hint: tr('Office work, little walking'), f: 1.2 },
  light: { label: tr('Lightly active'), hint: tr('Lots of standing or walking, 7,000–10,000 steps'), f: 1.3 },
  active: { label: tr('Active'), hint: tr('A job on your feet, over 10,000 steps'), f: 1.4 },
  very: { label: tr('Very active'), hint: tr('Hard physical work'), f: 1.5 },
};
const PER_WORKOUT = 0.035; // multiplier added per weekly workout (~45–60 min)

export const GOALS = {
  cut: { label: tr('Cut'), sub: tr('Lose fat'), icon: '↘' },
  maintain: { label: tr('Save'), sub: tr('Maintain weight'), icon: '→' },
  bulk: { label: tr('Bulk'), sub: tr('Gain muscle mass'), icon: '↗' },
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
    messages.push(tr('Enter the length of the period and a target weight.'));
    out.level = level;
    return out;
  }

  const dw = targetWeight - weight;
  const ratePct = Math.abs(dw) / weight / weeks * 100;
  out.ratePct = Number(ratePct.toFixed(2));

  if (goal === 'cut' && dw >= 0) {
    bump('error');
    messages.push(tr('For a cut, the target weight must be lower than your current weight.'));
  }
  if (goal === 'bulk' && dw <= 0) {
    bump('error');
    messages.push(tr('For a bulk, the target weight must be higher than your current weight.'));
  }
  if (goal === 'maintain' && Math.abs(dw) / weight > 0.02) {
    bump('warn');
    messages.push(tr('When maintaining, the target weight is usually close to your current weight (±{0} kg). If you want to lose or gain, a cut or a bulk is a better choice.', (weight * 0.02).toFixed(1)));
  }
  if (height && bmi(targetWeight, height) < LIMITS.minBmi) {
    bump('error');
    const minW = LIMITS.minBmi * (height / 100) ** 2;
    messages.push(tr('The target weight is below the healthy weight range (BMI {0}). The minimum for your height is about {1} kg.', LIMITS.minBmi, minW.toFixed(1)));
  }
  if (validBf(targetBf) && targetBf < LIMITS.minBf[sex]) {
    bump('error');
    messages.push(tr('A target body fat of {0}% is too low to be healthy. A reasonable minimum is {1}%.', targetBf, LIMITS.minBf[sex]));
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
      messages.push(tr('The target needs a change of about {0} kg per week ({1}% of body weight), above the safe pace of {2}% per week. The plan will be limited to a safe pace.', perWeek, ratePct.toFixed(1), maxPct));
      out.suggestion = { weeks: sugWeeks, targetWeight: sugTarget };
    }
  }

  if (validBf(bf) && validBf(targetBf) && level !== 'error') {
    const projected = projectBf(goal, weight, bf, targetWeight);
    out.projectedBf = projected;
    const tooAggressive = goal === 'bulk' ? false : targetBf < projected - 2;
    if (tooAggressive) {
      bump('warn');
      messages.push(tr('Given the target weight, the expected body fat at the end of the period is about {0}%. A target of {1}% needs a longer period or a lower target weight.', projected, targetBf));
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
    warnings.push(tr('Calories were limited to a safe floor of {0} kcal.', Math.round(floor)));
  }
  calories = round(calories, 10);

  const plannedKgPerWeek = ((calories - e.tdee) * 7) / KCAL_PER_KG;
  const capped = !reached && Math.abs(plannedKgPerWeek) + 0.02 < Math.abs(requiredKgPerWeek);
  if (capped) {
    warnings.push(tr('Reaching the target on time needs a pace of {0} kg per week. The plan is limited to a safe pace of {1} kg per week.', Math.abs(requiredKgPerWeek).toFixed(2), Math.abs(plannedKgPerWeek).toFixed(2)));
  }
  if (reached) warnings.push(tr('You reached this period\'s target weight! Calories were adjusted for maintenance.'));

  const m = macros(period.goal, calories, weight, bf, profile.prefs?.diet);
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

export function macros(goal, calories, weight, bf, diet = 'omni') {
  const lbm = bf ? weight * (1 - bf / 100) : weight * 0.8;
  if (diet === 'keto' || diet === 'carnivore') {
    // Low-carb: carbs capped (keto ≤50 g total, carnivore near zero), fat fills the rest.
    const p = round(clamp(lbm * (goal === 'cut' ? 2.5 : 2.2), weight * 1.4, weight * 2.4), 5);
    const c = diet === 'keto' ? Math.min(50, round(calories * 0.1 / 4, 5)) : 5; // keto: ≤50 g total ≈ 20–30 g net
    const f = Math.max(round((calories - p * 4 - c * 4) / 9, 5), round(weight * 0.6, 5));
    return { protein: p, carbs: c, fat: f };
  }
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
