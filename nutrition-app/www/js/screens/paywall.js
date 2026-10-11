// The payment screen for the AI features. Shows the plans and the payment
// methods that fit this device (Apple Pay on iPhone, Google Pay on Android,
// card and PayPal everywhere). Until a provider is connected in config.js it
// explains that payment isn't available yet instead of taking money.

import { h, icon, sheet } from '../util.js';
import { BILLING } from '../config.js';
import { AI_FEATURES, METHOD_LABEL, paymentMethods, checkoutLink, priceText } from '../billing.js';
import { aiStatus } from '../store.js';

// Drawn rather than the U+F8FF character, which only Apple's fonts have.
function appleLogo() {
  const span = h('span', { class: 'pay-apple', 'aria-hidden': 'true' });
  span.innerHTML = '<svg viewBox="0 0 17 20" width="17" height="20" fill="currentColor"><path d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2.1-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.5 1.3 0 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4zM11.6 3c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5z"/></svg>';
  return span;
}

function methodButton(method, onPay) {
  const content = {
    applepay: [appleLogo(), h('span', null, 'Pay')],
    googlepay: [h('span', { class: 'pay-g', 'aria-hidden': 'true' }, 'G'), h('span', null, 'Pay')],
    paypal: [h('span', { class: 'pay-pp' }, 'Pay'), h('span', { class: 'pay-pal' }, 'Pal')],
    card: [icon('card', 18), h('span', null, 'כרטיס אשראי')],
  }[method];
  return h('button', {
    type: 'button',
    class: `pay-btn pay-${method}`,
    'data-method': method,
    'aria-label': `תשלום ב-${METHOD_LABEL[method]}`,
    onclick: () => onPay(method),
  }, ...content);
}

// feature: a key of AI_FEATURES, or '' when opened from the profile.
export function openPaywall(feature = '') {
  const access = aiStatus();
  let plan = BILLING.plans[BILLING.plans.length - 1].id; // the yearly plan is preselected
  return sheet('נוטרי פלוס', () => {
    const status = h('p', { class: 'pay-status small', role: 'status', 'aria-live': 'polite' });
    const planList = h('div', { class: 'plan-list', role: 'radiogroup', 'aria-label': 'בחירת מנוי' });
    const drawPlans = () => {
      planList.replaceChildren(...BILLING.plans.map((p) => h('button', {
        type: 'button',
        role: 'radio',
        class: 'plan' + (p.id === plan ? ' on' : ''),
        'aria-checked': p.id === plan ? 'true' : 'false',
        'data-plan': p.id,
        onclick: () => { plan = p.id; drawPlans(); },
      },
      h('b', null, p.label),
      h('span', { class: 'num' }, priceText(p)),
      p.note ? h('small', null, p.note) : null)));
    };
    drawPlans();

    const pay = (method) => {
      const url = checkoutLink(plan, method);
      if (!url) {
        status.textContent = `התשלום ב-${METHOD_LABEL[method]} עוד לא מחובר. ברגע שיחובר ספק תשלומים, הכפתור הזה יעבור לדף התשלום.`;
        status.classList.add('show');
        return;
      }
      location.assign(url);
    };
    const methods = paymentMethods({ ua: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints || 0 });

    const intro = feature
      ? `${AI_FEATURES[feature]} ${access.state === 'locked' ? 'זמין/ה במנוי' : 'כלול/ה במנוי'}.`
      : 'הכלים החכמים של נוטרי במנוי אחד.';
    const trialLine = access.state === 'trial'
      ? `נשארו ${access.daysLeft} ימים בתקופת הניסיון החינמית.`
      : access.state === 'locked' ? (BILLING.trialDays ? 'תקופת הניסיון החינמית הסתיימה.' : 'העוזר החכם ומצלמת הקלוריות זמינים במנוי.') : 'המנוי שלך פעיל.';

    return h('div', { class: 'paywall', id: 'paywall' },
      h('p', { class: 'lead' }, intro),
      h('p', { class: 'muted small', id: 'pay-trial' }, trialLine),
      h('ul', { class: 'pay-list' },
        h('li', null, icon('sparkle', 16), 'עוזר תזונה חכם: תחליפים, שאלות ורעיונות למתכונים'),
        h('li', null, icon('camera', 16), 'מצלמת קלוריות: צילום הצלחת וספירת קלוריות')),
      h('p', { class: 'muted small' }, 'בחינם תמיד: התפריט, המתכונים, רשימת הקניות, ההחלפות והערכת אחוז השומן.'),
      planList,
      h('div', { class: 'pay-methods', id: 'pay-methods' }, ...methods.map((m) => methodButton(m, pay))),
      status,
      h('p', { class: 'muted tiny' }, 'המחיר כולל מע״מ. המנוי מתחדש אוטומטית ואפשר לבטל אותו בכל עת.'));
  });
}
