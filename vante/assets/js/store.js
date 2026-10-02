/*
 * VANTÉ — store state.
 * Cart, saved pieces and cookie consent, persisted in localStorage (strictly
 * necessary storage: the cart only works if it is remembered). Every change
 * fires a "vante:cart" / "vante:wish" / "vante:consent" event on window, so any
 * part of any page can react without knowing who changed what.
 *
 * Nothing here trusts itself for money: the checkout endpoint re-prices every
 * line from its own catalogue before taking payment.
 */
(function () {
  var CFG = window.VANTE_CONFIG;
  var CAT = window.VANTE_CATALOG;
  var KEYS = { cart: "vante.cart.v1", wish: "vante.saved.v1", consent: "vante.consent.v1" };
  var MAX_QTY = 10;
  var CONSENT_VERSION = 1;

  /* localStorage can throw (private mode, file://, quota). Fall back to memory. */
  var memory = {};
  function read(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return key in memory ? memory[key] : fallback;
    }
  }
  function write(key, value) {
    memory[key] = value;
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* memory only */ }
  }
  function emit(name, detail) {
    var ev;
    try { ev = new CustomEvent(name, { detail: detail }); }
    catch (e) { ev = document.createEvent("CustomEvent"); ev.initCustomEvent(name, false, false, detail); }
    window.dispatchEvent(ev);
  }

  var money = (function () {
    var fmt;
    try { fmt = new Intl.NumberFormat(CFG.locale, { style: "currency", currency: CFG.currency }); }
    catch (e) { fmt = { format: function (n) { return "$" + n.toFixed(2); } }; }
    return function (n) {
      var s = fmt.format(n);
      return /\.00$/.test(s) ? s.slice(0, -3) : s; // $35, not $35.00 — but $6.95 stays
    };
  })();

  /* ---------------- Cart ---------------- */
  // A line is { sku, id, color, size, qty }. Everything else is looked up live
  // from the catalogue, so a price change never leaves stale data in a cart.
  function sanitize(lines) {
    if (!Array.isArray(lines)) return [];
    var out = [];
    lines.forEach(function (l) {
      var p = l && CAT.product(l.id);
      if (!p) return;
      var v = CAT.variant(p, l.color);
      if (!v || v.color !== l.color) return;
      if (CAT.sizes(p, v).indexOf(l.size) === -1) return;
      var q = Math.max(1, Math.min(MAX_QTY, parseInt(l.qty, 10) || 1));
      out.push({ sku: CAT.sku(p, l.color, l.size), id: p.id, color: l.color, size: l.size, qty: q });
    });
    return out;
  }
  var lines = sanitize(read(KEYS.cart, []));

  function save(reason, line) {
    write(KEYS.cart, lines);
    emit("vante:cart", { reason: reason, line: line || null, cart: cart.summary() });
  }

  var cart = {
    MAX_QTY: MAX_QTY,
    lines: function () { return lines.slice(); },
    count: function () { return lines.reduce(function (n, l) { return n + l.qty; }, 0); },
    add: function (id, color, size, qty) {
      var p = CAT.product(id);
      if (!p) return null;
      var sku = CAT.sku(p, color, size);
      var line = lines.filter(function (l) { return l.sku === sku; })[0];
      qty = Math.max(1, parseInt(qty, 10) || 1);
      if (line) line.qty = Math.min(MAX_QTY, line.qty + qty);
      else {
        line = { sku: sku, id: id, color: color, size: size, qty: Math.min(MAX_QTY, qty) };
        lines.push(line);
      }
      save("add", line);
      return line;
    },
    setQty: function (sku, qty) {
      qty = parseInt(qty, 10);
      if (isNaN(qty)) return;
      if (qty <= 0) return cart.remove(sku);
      lines.forEach(function (l) { if (l.sku === sku) l.qty = Math.min(MAX_QTY, qty); });
      save("qty");
    },
    remove: function (sku) {
      lines = lines.filter(function (l) { return l.sku !== sku; });
      save("remove");
    },
    clear: function () { lines = []; save("clear"); },
    /* Expand lines with product data and prices for display. */
    detailed: function () {
      return lines.map(function (l) {
        var p = CAT.product(l.id), v = CAT.variant(p, l.color);
        var unit = CAT.price(p, v);
        return {
          sku: l.sku, id: l.id, color: l.color, size: l.size, qty: l.qty,
          name: p.name, colorName: CAT.COLORS[l.color].name, unit: unit, total: unit * l.qty,
          image: CAT.image(v.images[0]), product: p
        };
      });
    },
    subtotal: function () {
      return cart.detailed().reduce(function (s, l) { return s + l.total; }, 0);
    },
    summary: function () {
      return { count: cart.count(), subtotal: cart.subtotal() };
    }
  };

  /* ---------------- Shipping ---------------- */
  var shipping = {
    zones: CFG.shipping,
    countries: function () {
      var list = [];
      CFG.shipping.forEach(function (z) {
        Object.keys(z.countries).forEach(function (code) { list.push({ code: code, name: z.countries[code], zone: z.id }); });
      });
      return list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    },
    zoneFor: function (country) {
      return CFG.shipping.filter(function (z) { return country in z.countries; })[0] || null;
    },
    /* Price of a method for a given subtotal; free standard over the threshold. */
    quote: function (country, methodId, subtotal) {
      var z = shipping.zoneFor(country);
      if (!z) return null;
      var m = z.methods.filter(function (x) { return x.id === methodId; })[0] || z.methods[0];
      var free = m.freeEligible && subtotal >= CFG.freeShippingOver;
      return { zone: z, method: m, price: free ? 0 : m.price, free: free };
    },
    remainingForFree: function (subtotal) { return Math.max(0, CFG.freeShippingOver - subtotal); }
  };

  /* ---------------- Saved pieces (wishlist) ---------------- */
  var saved = read(KEYS.wish, []);
  if (!Array.isArray(saved)) saved = [];
  saved = saved.filter(function (id) { return !!CAT.product(id); });
  var wish = {
    list: function () { return saved.slice(); },
    has: function (id) { return saved.indexOf(id) !== -1; },
    toggle: function (id) {
      if (wish.has(id)) saved = saved.filter(function (x) { return x !== id; });
      else saved.push(id);
      write(KEYS.wish, saved);
      emit("vante:wish", { id: id, saved: wish.has(id) });
      return wish.has(id);
    }
  };

  /* ---------------- Consent ---------------- */
  // Categories: necessary is always on. The store ships no analytics or
  // advertising code today; scripts that need consent must check
  // VANTE.consent.allowed("analytics") before loading.
  var consent = {
    CATEGORIES: ["necessary", "preferences", "analytics", "marketing"],
    get: function () {
      var c = read(KEYS.consent, null);
      return c && c.v === CONSENT_VERSION ? c : null;
    },
    set: function (choices) {
      var c = {
        v: CONSENT_VERSION, at: new Date().toISOString(),
        necessary: true,
        preferences: !!choices.preferences,
        analytics: !!choices.analytics,
        marketing: !!choices.marketing
      };
      write(KEYS.consent, c);
      emit("vante:consent", c);
      return c;
    },
    allowed: function (cat) {
      if (cat === "necessary") return true;
      var c = consent.get();
      return !!(c && c[cat]);
    }
  };

  window.VANTE = {
    config: CFG, catalog: CAT, cart: cart, shipping: shipping, wish: wish, consent: consent,
    money: money, emit: emit
  };
})();
