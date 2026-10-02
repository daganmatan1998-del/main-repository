/*
 * VANTÉ — store configuration.
 * Everything a non-developer may need to change lives here: currency, shipping
 * zones and rates, business details printed in the legal pages, and the
 * checkout endpoint. Values in [[double brackets]] are placeholders that must be
 * replaced with the real registered details before launch.
 */
window.VANTE_CONFIG = {
  brand: "VANTÉ",
  tagline: "Made to be you",
  currency: "USD",
  locale: "en-US",

  business: {
    legalName: "[[Registered business name]]",
    registration: "[[Israeli company / Osek Murshe number]]",
    address: "[[Street, City, Israel]]",
    email: "care@vante.store",
    privacyEmail: "privacy@vante.store",
    accessibilityEmail: "access@vante.store",
    accessibilityCoordinator: "[[Accessibility coordinator name]]",
    phone: "[[+972 ...]]",
    hours: "Sunday–Thursday, 09:00–17:00 (Israel time)",
    governingCity: "Tel Aviv–Jaffa",
    effectiveDate: "October 1, 2026"
  },

  // Free standard shipping threshold, per order, in store currency.
  freeShippingOver: 120,

  // Every piece is printed to order by our production partners, then shipped.
  processingDays: "2–5 business days",

  /*
   * Shipping zones. To add a market: add a zone (or a country to an existing
   * zone). `methods` are offered at checkout in this order.
   */
  shipping: [
    {
      id: "us",
      name: "United States",
      countries: { US: "United States" },
      duties: "Duties and import taxes are not charged on domestic US orders.",
      methods: [
        { id: "standard", name: "Standard", eta: "5–9 business days", price: 6.95, freeEligible: true },
        { id: "express", name: "Express", eta: "2–4 business days", price: 16.95, freeEligible: false }
      ]
    },
    {
      id: "il",
      name: "Israel",
      countries: { IL: "Israel" },
      duties: "Orders to Israel are shipped Delivered Duty Unpaid. Import VAT may apply on delivery under current Israeli import rules.",
      methods: [
        { id: "standard", name: "Standard", eta: "10–18 business days", price: 7.95, freeEligible: true },
        { id: "express", name: "Express courier", eta: "5–8 business days", price: 19.95, freeEligible: false }
      ]
    },
    {
      id: "gcc",
      name: "Gulf",
      countries: { AE: "United Arab Emirates", SA: "Saudi Arabia", QA: "Qatar", KW: "Kuwait", BH: "Bahrain", OM: "Oman" },
      duties: "Orders are shipped Delivered Duty Unpaid. Customs duties and VAT set by the destination country are payable by the recipient.",
      methods: [
        { id: "standard", name: "Tracked international", eta: "10–20 business days", price: 12.95, freeEligible: true },
        { id: "express", name: "Express courier", eta: "5–9 business days", price: 29.95, freeEligible: false }
      ]
    },
    {
      id: "mena",
      name: "Middle East & North Africa",
      countries: { JO: "Jordan", EG: "Egypt", MA: "Morocco" },
      duties: "Orders are shipped Delivered Duty Unpaid. Customs duties and taxes set by the destination country are payable by the recipient.",
      methods: [
        { id: "standard", name: "Tracked international", eta: "12–25 business days", price: 14.95, freeEligible: true }
      ]
    }
  ],

  /*
   * Checkout. When `endpoint` is set, the cart is POSTed there and the
   * response's `url` is opened (Stripe Checkout, see /vante/worker). Prices are
   * re-validated server-side; the browser total is never trusted.
   */
  checkout: {
    endpoint: "",
    provider: "Stripe"
  },

  returnsWindowDays: 14,
  defectWindowDays: 30
};
