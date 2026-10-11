// Runtime configuration. The only file that changes between web and native builds.
//
// API_BASE: where the chat proxy lives.
//   ''  -> same origin (the Cloudflare Worker serves both the app and /api/chat,
//          and the local dev server does the same).
//   'https://nutri-api.<you>.workers.dev' -> when the app is hosted elsewhere,
//          or wrapped with Capacitor (native apps have no same-origin server).
export const API_BASE = '';

export const APP_VERSION = '1.13.0';

// Cloud accounts (Supabase): sign in with Google, data kept in the user's own
// private row. Both empty = no accounts; everything stays on the device.
// The anon key is public by design — row-level security in
// supabase/setup.sql is what keeps each user's data to themselves.
export const CLOUD = {
  url: 'https://neswgxihjffyftzwxbjv.supabase.co',
  anonKey: 'sb_publishable_rQvwPP8gZm3QS5mbfKxDpg_QuObOSu5',
};

// Paid plan for the AI features (assistant, recipe ideas, calorie camera).
// The body-fat estimate and everything that runs on the device stay free.
// provider / checkoutUrl are empty until a payment provider is connected;
// until then the payment screen shows the options but cannot take payment.
export const BILLING = {
  enabled: true,
  trialDays: 0, // free AI days from registration; 0 = no trial (off while testing; was 7)
  currency: '₪',
  plans: [
    { id: 'monthly', label: 'חודשי', price: 29.9, per: 'לחודש' },
    { id: 'yearly', label: 'שנתי', price: 249, per: 'לשנה', note: 'חיסכון של כ-30%' },
  ],
  provider: '', // e.g. 'stripe' | 'paypal' | 'payplus' — not connected yet
  checkoutUrl: '', // the provider's hosted checkout page, once connected
};
