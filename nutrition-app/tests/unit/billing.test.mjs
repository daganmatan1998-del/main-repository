import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiAccess, canUseAI, paymentMethods, checkoutLink, priceText } from '../../www/js/billing.js';

const B = { enabled: true, trialDays: 7, currency: '₪', plans: [{ id: 'monthly', label: 'חודשי', price: 29.9, per: 'לחודש' }, { id: 'yearly', label: 'שנתי', price: 249, per: 'לשנה' }], provider: '', checkoutUrl: '' };
const NOW = Date.parse('2026-11-20T10:00:00Z');

test('free trial from registration, then locked', () => {
  assert.deepEqual(aiAccess({ regDay: '2026-11-20', today: '2026-11-20', now: NOW, billing: B }), { state: 'trial', daysLeft: 7 });
  assert.deepEqual(aiAccess({ regDay: '2026-11-14', today: '2026-11-20', now: NOW, billing: B }), { state: 'trial', daysLeft: 1 });
  const locked = aiAccess({ regDay: '2026-11-13', today: '2026-11-20', now: NOW, billing: B });
  assert.deepEqual(locked, { state: 'locked' });
  assert.equal(canUseAI(locked), false);
  assert.equal(aiAccess({ regDay: '2026-11-20', today: '2026-11-20', now: NOW, billing: { ...B, trialDays: 0 } }).state, 'locked', 'no trial');
});

test('an active plan unlocks until it ends; billing switched off unlocks everything', () => {
  const sub = { plan: 'yearly', until: NOW + 86400000, method: 'card' };
  assert.equal(aiAccess({ subscription: sub, regDay: '2026-01-01', today: '2026-11-20', now: NOW, billing: B }).state, 'active');
  assert.equal(aiAccess({ subscription: { ...sub, until: NOW - 1 }, regDay: '2026-01-01', today: '2026-11-20', now: NOW, billing: B }).state, 'locked', 'an expired plan');
  assert.equal(canUseAI(aiAccess({ regDay: '2026-01-01', today: '2026-11-20', now: NOW, billing: { ...B, enabled: false } })), true);
});

test('payment buttons fit the device: Apple Pay on iPhone/iPad, Google Pay on Android, card and PayPal everywhere', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
  const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15';
  const android = 'Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
  const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
  assert.deepEqual(paymentMethods({ ua: iphone }), ['applepay', 'card', 'paypal']);
  assert.deepEqual(paymentMethods({ ua: ipad, maxTouchPoints: 5 }), ['applepay', 'card', 'paypal']);
  assert.deepEqual(paymentMethods({ ua: ipad, maxTouchPoints: 0 }), ['card', 'paypal'], 'a real Mac');
  assert.deepEqual(paymentMethods({ ua: android }), ['googlepay', 'card', 'paypal']);
  assert.deepEqual(paymentMethods({ ua: windows }), ['card', 'paypal']);
});

test('checkout goes nowhere until a provider is connected, then to its hosted page', () => {
  assert.equal(checkoutLink('yearly', 'card', { billing: B }), null);
  const live = { ...B, provider: 'stripe', checkoutUrl: 'https://pay.example.com/checkout' };
  const url = new URL(checkoutLink('yearly', 'applepay', { billing: live, ref: 'dev1' }));
  assert.equal(url.origin + url.pathname, 'https://pay.example.com/checkout');
  assert.deepEqual([url.searchParams.get('plan'), url.searchParams.get('method'), url.searchParams.get('ref')], ['yearly', 'applepay', 'dev1']);
  assert.equal(checkoutLink('nope', 'card', { billing: live }), null);
  assert.match(priceText(B.plans[0], B), /₪29\.9 לחודש/);
});
