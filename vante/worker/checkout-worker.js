/*
 * VANTÉ — checkout endpoint (Cloudflare Worker, module syntax).
 *
 * Receives the bag from checkout.html, re-prices every line from the catalogue
 * below (the browser's numbers are never trusted), prices shipping for the
 * destination, and opens a Stripe Checkout Session. Responds { url } for the
 * browser to redirect to.
 *
 * Secrets / vars (wrangler secret put …):
 *   STRIPE_SECRET_KEY   sk_live_… or sk_test_…
 *   SITE_URL            https://your-domain.example   (no trailing slash)
 *   ALLOWED_ORIGIN      same as SITE_URL (CORS)
 *
 * Keep PRODUCTS / SHIPPING in step with assets/js/catalog.js and config.js:
 * `node tools/check-worker-sync.mjs` fails if they drift.
 */

const TOP = ["XS", "S", "M", "L", "XL", "XXL"];
const BOTTOM = ["S", "M", "L", "XL"];
const BW = ["black", "white"];

export const PRODUCTS = {
  "archangel-tee": { name: "Archangel Tee", price: 35, sizes: TOP, colors: BW },
  "carrara-tee": { name: "Carrara Tee", price: 35, sizes: TOP, colors: BW },
  "crowned-tee": { name: "Crowned Tee", price: 35, sizes: TOP, colors: BW },
  "pegasus-tee": { name: "Pegasus Tee", price: 34, sizes: TOP, colors: BW },
  "celestial-tee": { name: "Celestial Tee", price: 33, sizes: TOP, colors: BW },
  "summit-tee": { name: "Summit Tee", price: 33, sizes: TOP, colors: BW },
  "monogram-tee": { name: "VA Monogram Tee", price: 32, sizes: TOP, colors: BW },
  "seraph-hoodie": { name: "Seraph Hoodie", price: 55, sizes: TOP, colors: BW },
  "cropped-hoodie": { name: "Signature Cropped Hoodie", price: 49, sizes: TOP, colors: BW },
  "signature-shorts": { name: "Signature Shorts", price: 24, sizes: BOTTOM, colors: BW },
  "monogram-shorts": { name: "VA Monogram Shorts", price: 22, sizes: BOTTOM, colors: BW },
  "icarus-tee": { name: "Icarus Tee", price: 35, sizes: TOP, colors: BW },
  "atlas-tee": { name: "Atlas Tee", price: 35, sizes: TOP, colors: BW },
  "monogram-crewneck": { name: "VA Monogram Crewneck", price: 49, sizes: TOP, colors: BW },
  "signature-crewneck": { name: "Made To Be You Crewneck", price: 52, sizes: TOP, colors: BW }
};

export const FREE_SHIPPING_OVER = 120;
export const SHIPPING = {
  us: { countries: ["US"], methods: { standard: { name: "Standard", price: 6.95, free: true, days: [5, 9] }, express: { name: "Express", price: 16.95, free: false, days: [2, 4] } } },
  il: { countries: ["IL"], methods: { standard: { name: "Standard", price: 7.95, free: true, days: [10, 18] }, express: { name: "Express courier", price: 19.95, free: false, days: [5, 8] } } },
  gcc: { countries: ["AE", "SA", "QA", "KW", "BH", "OM"], methods: { standard: { name: "Tracked international", price: 12.95, free: true, days: [10, 20] }, express: { name: "Express courier", price: 29.95, free: false, days: [5, 9] } } },
  mena: { countries: ["JO", "EG", "MA"], methods: { standard: { name: "Tracked international", price: 14.95, free: true, days: [12, 25] } } }
};
const COLOR_NAMES = { black: "Black", white: "White" };
const MAX_LINES = 20, MAX_QTY = 10;

const cents = (n) => Math.round(n * 100);
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/* Validate and price an order. Throws Error(message) with a customer-safe message. */
export function priceOrder(body) {
  if (!body || !Array.isArray(body.items) || !body.items.length) throw new Error("Your bag is empty.");
  if (body.items.length > MAX_LINES) throw new Error("Too many lines in one order.");
  const lines = body.items.map((it) => {
    const p = PRODUCTS[it && it.id];
    if (!p) throw new Error("A piece in your bag is no longer available.");
    if (!p.colors.includes(it.color) || !p.sizes.includes(it.size)) throw new Error(`${p.name}: that colour or size is not available.`);
    const qty = Number(it.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw new Error("Invalid quantity.");
    return { id: it.id, name: p.name, color: it.color, size: it.size, qty, unit: p.price };
  });
  const subtotal = lines.reduce((s, l) => s + l.unit * l.qty, 0);
  const zoneId = Object.keys(SHIPPING).find((z) => SHIPPING[z].countries.includes(body.country));
  if (!zoneId) throw new Error("We do not ship to that country yet.");
  const zone = SHIPPING[zoneId];
  const methodId = zone.methods[body.method] ? body.method : Object.keys(zone.methods)[0];
  const m = zone.methods[methodId];
  const shipping = m.free && subtotal >= FREE_SHIPPING_OVER ? 0 : m.price;
  return { lines, subtotal, shipping, zoneId, methodId, method: m, total: subtotal + shipping };
}

async function stripe(env, path, params) {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString()
  });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error("Payment provider error"), { detail: json });
  return json;
}

function cors(env, extra) {
  return Object.assign({
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  }, extra || {});
}
const json = (env, data, status) => new Response(JSON.stringify(data), { status: status || 200, headers: cors(env, { "Content-Type": "application/json" }) });

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
    const url = new URL(request.url);
    if (request.method !== "POST" || !/\/(checkout)?$/.test(url.pathname)) return json(env, { error: "Not found" }, 404);
    if (env.ALLOWED_ORIGIN && request.headers.get("Origin") && request.headers.get("Origin") !== env.ALLOWED_ORIGIN) return json(env, { error: "Forbidden" }, 403);
    if (!env.STRIPE_SECRET_KEY || !env.SITE_URL) return json(env, { error: "Checkout is not configured." }, 503);

    let body;
    try { body = await request.json(); } catch (e) { return json(env, { error: "Invalid request." }, 400); }

    let order;
    try { order = priceOrder(body); } catch (e) { return json(env, { error: e.message }, 400); }

    const email = str(body.email, 200);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(env, { error: "Please enter a valid email." }, 400);
    const a = body.address || {};

    try {
      // A customer record lets Stripe prefill the address the shopper already typed.
      const customer = await stripe(env, "customers", {
        email,
        name: (str(a.firstName, 80) + " " + str(a.lastName, 80)).trim(),
        phone: str(a.phone, 40),
        "shipping[name]": (str(a.firstName, 80) + " " + str(a.lastName, 80)).trim(),
        "shipping[phone]": str(a.phone, 40),
        "shipping[address][line1]": str(a.line1, 200),
        "shipping[address][line2]": str(a.line2, 200),
        "shipping[address][city]": str(a.city, 100),
        "shipping[address][state]": str(a.region, 100),
        "shipping[address][postal_code]": str(a.postal, 20),
        "shipping[address][country]": body.country,
        "metadata[marketing_opt_in]": body.marketing ? "yes" : "no"
      });

      const p = {
        mode: "payment",
        customer: customer.id,
        "customer_update[shipping]": "auto",
        "shipping_address_collection[allowed_countries][0]": body.country,
        "phone_number_collection[enabled]": "true",
        success_url: env.SITE_URL + "/checkout.html?status=success&session_id={CHECKOUT_SESSION_ID}",
        cancel_url: env.SITE_URL + "/checkout.html?status=cancelled",
        "shipping_options[0][shipping_rate_data][type]": "fixed_amount",
        "shipping_options[0][shipping_rate_data][display_name]": order.method.name,
        "shipping_options[0][shipping_rate_data][fixed_amount][amount]": String(cents(order.shipping)),
        "shipping_options[0][shipping_rate_data][fixed_amount][currency]": "usd",
        "shipping_options[0][shipping_rate_data][delivery_estimate][minimum][unit]": "business_day",
        "shipping_options[0][shipping_rate_data][delivery_estimate][minimum][value]": String(order.method.days[0]),
        "shipping_options[0][shipping_rate_data][delivery_estimate][maximum][unit]": "business_day",
        "shipping_options[0][shipping_rate_data][delivery_estimate][maximum][value]": String(order.method.days[1] + 5),
        "metadata[zone]": order.zoneId,
        "metadata[method]": order.methodId,
        "metadata[items]": order.lines.map((l) => `${l.id}:${l.color}:${l.size}:${l.qty}`).join(",").slice(0, 500)
      };
      order.lines.forEach((l, i) => {
        p[`line_items[${i}][quantity]`] = String(l.qty);
        p[`line_items[${i}][price_data][currency]`] = "usd";
        p[`line_items[${i}][price_data][unit_amount]`] = String(cents(l.unit));
        p[`line_items[${i}][price_data][product_data][name]`] = `${l.name} — ${COLOR_NAMES[l.color]} / ${l.size}`;
        p[`line_items[${i}][price_data][product_data][metadata][sku]`] = `${l.id}-${l.color}-${l.size}`;
      });
      const session = await stripe(env, "checkout/sessions", p);
      return json(env, { url: session.url });
    } catch (e) {
      console.error("stripe", e.detail || e.message);
      return json(env, { error: "We could not start payment. Please try again." }, 502);
    }
  }
};
