// Client side of the nutrition assistant. API keys live only on
// the server (server/worker.js); the app talks to /api/chat on that proxy.
//
// Privacy: the context sent with each question is the minimum the assistant
// needs — no name, no photos, no registration date.

import { t as tr, lang } from './i18n.js';
import { serverText } from './server-texts.js';
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
      sex: p.sex === 'female' ? 'Female' : 'Male',
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
      items: m.items.map((i) => `${FOODS.find((f) => f.id === i.foodId).name} ${i.grams} g (${ROLE_LABEL[i.role]}, ${i.kcal} kcal, P${i.p}/C${i.c}/F${i.f})`),
      // Groups the user chose to leave out of this meal (calories moved to the rest).
      ...(m.removed && m.removed.length ? { removedByUser: m.removed.map((g) => ROLE_LABEL[g]) } : {}),
      // Replaced by what the calorie camera saw on the plate.
      ...(m.eaten ? { actuallyEaten: m.eaten.items.map((i) => `${i.name} ${i.grams} g (${i.kcal} kcal)`) } : {}),
    })),
    ...extra,
  };
}

export async function ask(messages, context) {
  if (!navigator.onLine) throw new ChatError('offline', tr('No internet connection.'));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  let res;
  try {
    res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: messages.map(({ role, content }) => ({ role, content })), context, lang }),
      signal: ctrl.signal,
    });
  } catch {
    throw new ChatError('offline', tr('Can\'t reach the assistant\'s server.'));
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const code = data?.error || `http_${res.status}`;
    throw new ChatError(code, tr('The assistant is unavailable right now.'));
  }
  // The server's fixed refusal is in English: show it in the app's language.
  return serverText(data.text);
}
