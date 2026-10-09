// Body-fat estimation helpers (pure, unit-tested).
//
// The photo estimate comes from Claude via /api/bodyfat. These formulas are
// the fallbacks and cross-checks:
//  - Deurenberg (1991): from BMI, age and sex. Population average; often off
//    for very muscular or very lean people.
//  - US Navy circumference method: from waist, neck (and hip for women).
//    Typically within ~3–4 points when measured carefully.

export function deurenberg({ sex, age, height, weight }) {
  const bmi = weight / ((height / 100) ** 2);
  const v = 1.2 * bmi + 0.23 * age - 10.8 * (sex === 'female' ? 0 : 1) - 5.4;
  return round1(clampPct(v));
}

export function navy({ sex, height, waist, neck, hip }) {
  if (!(waist > 0 && neck > 0 && height > 0)) return null;
  let v;
  if (sex === 'female') {
    if (!(hip > 0) || waist + hip - neck <= 0) return null;
    v = 495 / (1.29579 - 0.35004 * Math.log10(waist + hip - neck) + 0.221 * Math.log10(height)) - 450;
  } else {
    if (waist - neck <= 0) return null;
    v = 495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(height)) - 450;
  }
  if (!Number.isFinite(v)) return null;
  return round1(clampPct(v));
}

// Combines whatever is available into one estimate with a range.
// ai: { estimate, low, high, confidence, notes } | null; tapeEstimate: number | null
export function combine({ ai, tapeEstimate, prior }) {
  if (ai && tapeEstimate !== null && tapeEstimate !== undefined) {
    const estimate = round1((ai.estimate + tapeEstimate) / 2);
    return {
      estimate,
      low: round1(Math.min(ai.low, tapeEstimate - 2, estimate)),
      high: round1(Math.max(ai.high, tapeEstimate + 2, estimate)),
      method: 'ai+tape',
      confidence: ai.confidence === 'low' ? 'medium' : 'high',
    };
  }
  if (ai) return { estimate: ai.estimate, low: ai.low, high: ai.high, method: 'ai', confidence: ai.confidence };
  if (tapeEstimate !== null && tapeEstimate !== undefined) {
    return { estimate: tapeEstimate, low: round1(tapeEstimate - 3), high: round1(tapeEstimate + 3), method: 'tape', confidence: 'medium' };
  }
  return { estimate: prior, low: round1(prior - 5), high: round1(prior + 5), method: 'bmi', confidence: 'low' };
}

function clampPct(v) {
  return Math.min(60, Math.max(3, v));
}

function round1(v) {
  return Math.round(v * 10) / 10;
}
