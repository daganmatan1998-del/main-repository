// Client side of the nutrition assistant. The Anthropic API key lives only on
// the server (server/worker.js); the app talks to /api/chat on that proxy.
//
// Privacy: the context sent with each question is the minimum the assistant
// needs — no name, no photos, no registration date.

import { API_BASE } from './config.js';
import { state, targets, dayPlan, currentMetrics, activePeriod, today } from './store.js';
import { allowedFoods, FOODS, ALLERGENS, DIETS, ROLE_LABEL } from './foods.js';
import { GOALS, ACTIVITY } from './nutrition.js';

export class ChatError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function buildContext(extra = {}) {
  const p = state.profile;
  const t = targets();
  const cur = currentMetrics();
  const per = activePeriod();
  const plan = dayPlan(today());
  const allowedIds = new Set(allowedFoods(p.prefs).map((f) => f.id));
  return {
    profile: {
      sex: p.sex === 'female' ? 'אישה' : 'גבר',
      age: p.age,
      heightCm: p.height,
      weightKg: cur?.weight,
      bodyFatPct: cur?.bf,
      activity: ACTIVITY[p.activity]?.label,
      workoutsPerWeek: p.workouts,
    },
    goal: per && {
      goal: GOALS[per.goal].label,
      targetWeightKg: per.targetWeight,
      targetBodyFatPct: per.targetBf,
      endDate: per.endDate,
    },
    dailyTargets: t && { kcal: t.calories, proteinG: t.protein, carbsG: t.carbs, fatG: t.fat },
    restrictions: {
      diet: DIETS.find((d) => d.id === p.prefs.diet)?.label,
      kosher: !!p.prefs.kosher,
      allergies: (p.prefs.allergies || []).map((a) => ALLERGENS.find((x) => x.id === a)?.label),
      dislikes: p.prefs.dislikes || '',
      mealsPerDay: p.prefs.mealsPerDay,
    },
    excludedFoods: FOODS.filter((f) => !allowedIds.has(f.id)).map((f) => f.name),
    todayPlan: plan.map((m) => ({
      meal: m.name,
      items: m.items.map((i) => `${FOODS.find((f) => f.id === i.foodId).name} ${i.grams} ג׳ (${ROLE_LABEL[i.role]}, ${i.kcal} קק״ל, ח${i.p}/פ${i.c}/ש${i.f})`),
    })),
    ...extra,
  };
}

export async function ask(messages, context) {
  if (!navigator.onLine) throw new ChatError('offline', 'אין חיבור לאינטרנט.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  let res;
  try {
    res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: messages.map(({ role, content }) => ({ role, content })), context }),
      signal: ctrl.signal,
    });
  } catch {
    throw new ChatError('offline', 'לא ניתן להתחבר לשרת העוזר.');
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const code = data?.error || `http_${res.status}`;
    throw new ChatError(code, data?.message || 'העוזר אינו זמין כרגע.');
  }
  return data.text;
}
