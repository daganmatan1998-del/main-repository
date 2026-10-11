// Paid plan for the AI features. Pure logic (no DOM), unit-tested directly.
//
// What's paid: the assistant (chat, substitution questions, recipe ideas) and
// the calorie camera — the features that spend AI quota. The body-fat
// estimate, the menu, recipes, shopping and everything on the device stay free.
//
// Status lives in settings.subscription: { plan, until (ms), method }.
// Until a payment provider is connected (BILLING.provider / checkoutUrl in
// config.js) nothing can set it, so after the free trial the AI features are
// locked. NOTE: this check runs on the device. Once payments are live, the
// Worker must check the subscription too, or the limit can be bypassed.

import { BILLING } from './config.js';
import { daysBetween } from './util.js';

export const AI_FEATURES = {
  chat: 'העוזר החכם',
  camera: 'מצלמת הקלוריות',
};

// { state: 'active' | 'trial' | 'locked', daysLeft?, until? }
export function aiAccess({ subscription, regDay, today, now, billing = BILLING }) {
  if (!billing.enabled) return { state: 'active', free: true };
  if (subscription && subscription.until > now) return { state: 'active', until: subscription.until, plan: subscription.plan };
  const used = regDay ? daysBetween(regDay, today) : 0;
  const daysLeft = Math.max(0, (billing.trialDays || 0) - used);
  return daysLeft > 0 ? { state: 'trial', daysLeft } : { state: 'locked' };
}

export const canUseAI = (access) => access.state !== 'locked';

// Which payment buttons this device should see. Apple Pay on iPhone / iPad
// (iPadOS reports itself as a Mac with a touch screen), Google Pay on Android,
// card and PayPal everywhere.
export function paymentMethods({ ua = '', maxTouchPoints = 0 } = {}) {
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  return [
    ...(ios ? ['applepay'] : []),
    ...(android ? ['googlepay'] : []),
    'card',
    'paypal',
  ];
}

export const METHOD_LABEL = { applepay: 'Apple Pay', googlepay: 'Google Pay', card: 'כרטיס אשראי', paypal: 'PayPal' };

// The one place a payment provider plugs in: send the buyer to the provider's
// hosted checkout with the plan and the chosen method. Card details never pass
// through the app or the Worker.
export function checkoutLink(planId, method, { billing = BILLING, ref = '' } = {}) {
  if (!billing.provider || !billing.checkoutUrl) return null;
  const plan = billing.plans.find((p) => p.id === planId);
  if (!plan) return null;
  const u = new URL(billing.checkoutUrl);
  u.searchParams.set('plan', plan.id);
  u.searchParams.set('method', method);
  if (ref) u.searchParams.set('ref', ref);
  return u.toString();
}

export const priceText = (plan, billing = BILLING) => `${billing.currency}${plan.price.toLocaleString('he-IL', { maximumFractionDigits: 2 })} ${plan.per}`;
