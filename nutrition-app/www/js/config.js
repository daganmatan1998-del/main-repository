// Runtime configuration. The only file that changes between web and native builds.
//
// API_BASE: where the chat proxy lives.
//   ''  -> same origin (the Cloudflare Worker serves both the app and /api/chat,
//          and the local dev server does the same).
//   'https://nutri-api.<you>.workers.dev' -> when the app is hosted elsewhere,
//          or wrapped with Capacitor (native apps have no same-origin server).
export const API_BASE = '';

export const APP_VERSION = '1.7.0';

// Paid plan for the AI features (assistant, recipe ideas, calorie camera).
// The body-fat estimate and everything that runs on the device stay free.
// provider / checkoutUrl are empty until a payment provider is connected;
// until then the payment screen shows the options but cannot take payment.
export const BILLING = {
  enabled: true,
  trialDays: 7, // free AI days from registration; 0 = no trial
  currency: '₪',
  plans: [
    { id: 'monthly', label: 'חודשי', price: 29.9, per: 'לחודש' },
    { id: 'yearly', label: 'שנתי', price: 249, per: 'לשנה', note: 'חיסכון של כ-30%' },
  ],
  provider: '', // e.g. 'stripe' | 'paypal' | 'payplus' — not connected yet
  checkoutUrl: '', // the provider's hosted checkout page, once connected
};
