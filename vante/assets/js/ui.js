/*
 * VANTÉ — shared interface.
 * Header, footer, cart drawer, search, quick view, cookie consent, page
 * transitions and the small motion layer every page uses. Page scripts
 * (home.js, shop.js, product.js, checkout.js) build on window.VANTE_UI.
 */
(function () {
  "use strict";

  var V = window.VANTE, CAT = V.catalog, CFG = V.config;
  var doc = document, root = doc.documentElement, body = doc.body;
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  root.classList.remove("no-js");
  if (reduced) root.classList.add("no-motion");
  var hasGSAP = !!(window.gsap && window.ScrollTrigger) && !reduced;
  if (window.gsap && window.ScrollTrigger) window.gsap.registerPlugin(window.ScrollTrigger);
  // Without the animation library every scene falls back to its static layout.
  if (!hasGSAP) root.classList.add("no-motion");

  /* ---------------- Helpers ---------------- */
  function $(sel, ctx) { return (ctx || doc).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function frag(html) { var t = doc.createElement("template"); t.innerHTML = html.trim(); return t.content; }
  function param(name) { try { return new URLSearchParams(location.search).get(name); } catch (e) { return null; } }
  function getPath(obj, path) { return path.split(".").reduce(function (o, k) { return o == null ? o : o[k]; }, obj); }
  function img(key) { return CAT.image(key); }
  function productUrl(p, color) { return "product.html?id=" + encodeURIComponent(p.id) + (color ? "&color=" + color : ""); }
  function otherColor(p, color) {
    var c = p.variants.filter(function (v) { return v.color !== color; })[0];
    return c ? c.color : color;
  }

  var ICON = {
    search: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>',
    bag: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 13H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
    user: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
    close: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19"/></svg>',
    menu: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h18M3 16h18"/></svg>',
    heart: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/></svg>',
    minus: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" style="width:14px;height:14px"><path d="M5 12h14"/></svg>',
    plus: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" style="width:14px;height:14px"><path d="M12 5v14M5 12h14"/></svg>',
    arrow: '<svg class="btn__arrow" viewBox="0 0 18 8" fill="none" stroke="currentColor" aria-hidden="true"><path d="M0 4h17M13.5 0.5 17 4l-3.5 3.5"/></svg>'
  };

  /* ---------------- Accordions ---------------- */
  doc.addEventListener("click", function (e) {
    var b = e.target.closest(".acc__btn");
    if (b) b.setAttribute("aria-expanded", String(b.getAttribute("aria-expanded") !== "true"));
  });

  /* ---------------- Toast ---------------- */
  var toastEl, toastTimer;
  function toast(msg) {
    if (!toastEl) { toastEl = doc.createElement("div"); toastEl.className = "toast"; toastEl.setAttribute("role", "status"); toastEl.setAttribute("aria-live", "polite"); body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add("is-open");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-open"); }, 3200);
  }

  /* ---------------- Layers: scrim, focus trap, scroll lock ---------------- */
  var scrim = doc.createElement("div");
  scrim.className = "scrim";
  body.appendChild(scrim);
  var openLayers = [];
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function lockScroll(on) {
    body.classList.toggle("is-locked", on);
    if (lenis) { if (on) lenis.stop(); else lenis.start(); }
  }
  function openLayer(el, opts) {
    opts = opts || {};
    var layer = { el: el, opener: doc.activeElement, onClose: opts.onClose, scrim: opts.scrim !== false };
    openLayers.push(layer);
    el.classList.add("is-open");
    el.removeAttribute("aria-hidden");
    if (layer.scrim) scrim.classList.add("is-open");
    lockScroll(true);
    setTimeout(function () {
      var target = opts.focus ? $(opts.focus, el) : $(FOCUSABLE, el);
      if (target) target.focus({ preventScroll: true });
    }, 60);
  }
  function closeLayer(el) {
    var i = -1;
    openLayers.forEach(function (l, idx) { if (l.el === el) i = idx; });
    if (i === -1) return;
    var layer = openLayers.splice(i, 1)[0];
    el.classList.remove("is-open");
    el.setAttribute("aria-hidden", "true");
    if (!openLayers.some(function (l) { return l.scrim; })) scrim.classList.remove("is-open");
    if (!openLayers.length) lockScroll(false);
    if (layer.onClose) layer.onClose();
    if (layer.opener && layer.opener.focus) layer.opener.focus({ preventScroll: true });
  }
  function closeTop() { if (openLayers.length) closeLayer(openLayers[openLayers.length - 1].el); }
  scrim.addEventListener("click", closeTop);
  doc.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && openLayers.length) { e.preventDefault(); closeTop(); return; }
    if (e.key === "Tab" && openLayers.length) {
      var el = openLayers[openLayers.length - 1].el;
      var f = $$(FOCUSABLE, el).filter(function (n) { return n.offsetParent !== null || n === doc.activeElement; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ---------------- Smooth scroll ---------------- */
  var lenis = null;
  if (!reduced && window.Lenis && !body.hasAttribute("data-no-smooth")) {
    lenis = new window.Lenis({ duration: 1.15, easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); }, smoothWheel: true });
    if (window.gsap && window.ScrollTrigger) {
      lenis.on("scroll", window.ScrollTrigger.update);
      window.gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
      window.gsap.ticker.lagSmoothing(0);
    } else {
      (function raf(t) { lenis.raf(t); requestAnimationFrame(raf); })(0);
    }
  }
  function scrollToEl(el) {
    if (lenis) lenis.scrollTo(el, { offset: -90 });
    else el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }

  /* ---------------- Header & announcement ---------------- */
  var page = body.getAttribute("data-page") || "";
  var NAV = [
    { href: "shop.html", label: "Shop", page: "shop" },
    { href: "collections.html", label: "Collections", page: "collections" },
    { href: "shop.html?filter=new", label: "New Arrivals", page: "new" },
    { href: "about.html", label: "About", page: "about" }
  ];
  function navCurrent(n) {
    if (n.page === "new") return page === "shop" && param("filter") === "new";
    if (n.page === "shop") return page === "shop" && param("filter") !== "new";
    return page === n.page;
  }

  var announce = frag(
    '<aside class="announce" id="announce" aria-label="Store announcement"><span>Complimentary standard shipping on orders over ' + esc(V.money(CFG.freeShippingOver)) +
    ' · Shipping to the United States, Israel &amp; the Gulf — <a href="shipping.html">details</a></span></aside>'
  );
  var header = frag(
    '<header class="header' + (body.hasAttribute("data-header-light") ? " header--light" : "") + '" id="header">' +
      '<div class="header__bar">' +
        '<nav class="header__nav" aria-label="Main">' +
          NAV.map(function (n) { return '<a class="link-grow" href="' + n.href + '"' + (navCurrent(n) ? ' aria-current="page"' : "") + ">" + n.label + "</a>"; }).join("") +
        "</nav>" +
        '<button class="icon-btn header__burger" type="button" aria-label="Open menu" aria-controls="menu" aria-expanded="false" data-open-menu>' + ICON.menu + "</button>" +
        '<a class="header__logo" href="index.html" aria-label="VANTÉ — home"><span class="wordmark">Vanté</span></a>' +
        '<div class="header__tools">' +
          '<button class="icon-btn" type="button" aria-label="Search" data-open-search>' + ICON.search + "</button>" +
          '<a class="icon-btn hide-mobile" href="account.html" aria-label="Account and saved pieces">' + ICON.user + "</a>" +
          '<button class="icon-btn cart-btn" type="button" aria-label="Bag, 0 items" data-open-cart>' + ICON.bag + '<span class="cart-count" aria-hidden="true">0</span></button>' +
        "</div>" +
      "</div>" +
    "</header>"
  );
  var skip = frag('<a class="skip-link" href="#main">Skip to content</a>');
  body.insertBefore(skip, body.firstChild);
  var mainEl = $("#main");
  if (!body.hasAttribute("data-no-announce")) body.insertBefore(announce, mainEl);
  body.insertBefore(header, mainEl);
  var headerEl = $("#header");
  var announceEl = $("#announce");

  function setAnnounceOffset() {
    var h = announceEl ? announceEl.offsetHeight : 0;
    root.style.setProperty("--announce-h", h + "px");
    if (announceEl) headerEl.classList.add("has-announce");
  }
  setAnnounceOffset();
  window.addEventListener("resize", setAnnounceOffset);

  var lastY = 0, ticking = false;
  function onScroll() {
    var y = window.pageYOffset || root.scrollTop;
    var threshold = announceEl ? announceEl.offsetHeight + 20 : 40;
    var floating = y > threshold;
    headerEl.classList.toggle("is-floating", floating);
    var openUI = openLayers.length > 0;
    headerEl.classList.toggle("is-hidden", !openUI && floating && y > lastY + 4 && y > 420);
    if (y < lastY - 4 || !floating) headerEl.classList.remove("is-hidden");
    lastY = y;
    ticking = false;
  }
  window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  onScroll();

  /* ---------------- Mobile menu ---------------- */
  var menu = frag(
    '<div class="menu" id="menu" role="dialog" aria-modal="true" aria-label="Menu" aria-hidden="true">' +
      '<button class="icon-btn menu__close" type="button" aria-label="Close menu" data-close>' + ICON.close + "</button>" +
      '<ul class="menu__links">' +
        NAV.concat([{ href: "account.html", label: "Account" }, { href: "contact.html", label: "Contact" }]).map(function (n, i) {
          return '<li><a href="' + n.href + '"><span style="transition-delay:' + (0.12 + i * 0.05) + 's">' + n.label + "</span></a></li>";
        }).join("") +
      "</ul>" +
      '<div class="menu__foot"><a href="shipping.html">Shipping &amp; delivery</a><a href="returns.html">Returns</a><span>' + esc(CFG.business.email) + "</span></div>" +
    "</div>"
  );
  body.appendChild(menu);
  var menuEl = $("#menu");
  var burger = $("[data-open-menu]");
  burger.addEventListener("click", function () {
    burger.setAttribute("aria-expanded", "true");
    openLayer(menuEl, { scrim: false, onClose: function () { burger.setAttribute("aria-expanded", "false"); } });
  });
  $("[data-close]", menuEl).addEventListener("click", function () { closeLayer(menuEl); });

  /* ---------------- Footer ---------------- */
  var year = new Date().getFullYear();
  var footer = frag(
    '<footer class="footer" id="footer">' +
      '<div class="wrap">' +
        '<div class="footer__top">' +
          '<div class="footer__news">' +
            '<h2 class="h3">Letters from the house</h2>' +
            '<p class="muted">New pieces, numbered drops and the stories behind them. A few times a season, never more.</p>' +
            '<form class="footer__news-form" data-newsletter novalidate>' +
              '<label class="sr-only" for="news-email">Email address</label>' +
              '<input id="news-email" type="email" name="email" placeholder="Email address" autocomplete="email" required>' +
              '<button type="submit">Subscribe</button>' +
            "</form>" +
            '<p class="footer__fine">By subscribing you agree to receive marketing email from VANTÉ. Unsubscribe at any time. See our <a href="privacy.html">Privacy Policy</a>.</p>' +
          "</div>" +
          '<div class="footer__cols">' +
            '<div class="footer__col"><h2 class="label">Shop</h2><a class="link-grow" href="shop.html">All pieces</a><a class="link-grow" href="shop.html?filter=new">New arrivals</a><a class="link-grow" href="shop.html?category=tees">T-Shirts</a><a class="link-grow" href="shop.html?category=hoodies">Hoodies</a><a class="link-grow" href="shop.html?category=sweatshirts">Sweatshirts</a><a class="link-grow" href="shop.html?category=shorts">Shorts</a></div>' +
            '<div class="footer__col"><h2 class="label">Client care</h2><a class="link-grow" href="contact.html">Contact</a><a class="link-grow" href="faq.html">FAQ &amp; size guide</a><a class="link-grow" href="shipping.html">Shipping &amp; delivery</a><a class="link-grow" href="returns.html">Returns &amp; cancellations</a><a class="link-grow" href="account.html">Saved pieces</a></div>' +
            '<div class="footer__col"><h2 class="label">House</h2><a class="link-grow" href="about.html">About VANTÉ</a><a class="link-grow" href="collections.html">Collections</a><a class="link-grow" href="accessibility.html">Accessibility</a><a class="link-grow" href="legal-notice.html">Legal notice</a></div>' +
          "</div>" +
        "</div>" +
      "</div>" +
      '<div class="footer__mark" aria-hidden="true">VANTÉ</div>' +
      '<div class="wrap footer__bottom">' +
        "<span>© " + year + " " + esc(CFG.brand) + ". All prices in " + esc(CFG.currency) + ".</span>" +
        '<nav class="footer__legal" aria-label="Legal">' +
          '<a href="terms.html">Terms of Service</a><a href="privacy.html">Privacy</a><a href="cookies.html">Cookies</a><a href="shipping.html">Shipping</a><a href="returns.html">Returns</a>' +
          '<button type="button" data-consent-settings>Cookie settings</button>' +
        "</nav>" +
      "</div>" +
    "</footer>"
  );
  if (!body.hasAttribute("data-no-footer")) body.appendChild(footer);

  /* Newsletter: posts to config.newsletter.endpoint when one is set; otherwise
     hands the request to the visitor's email client, so nothing is pretended. */
  doc.addEventListener("submit", function (e) {
    var form = e.target.closest("[data-newsletter]");
    if (!form) return;
    e.preventDefault();
    var input = $("input[type=email]", form);
    if (!input.checkValidity()) { toast("Please enter a valid email address."); input.focus(); return; }
    var ep = CFG.newsletter && CFG.newsletter.endpoint;
    if (ep) {
      fetch(ep, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: input.value }) })
        .then(function (r) { if (!r.ok) throw new Error(); toast("Thank you. Please confirm from the email we just sent."); form.reset(); })
        .catch(function () { toast("We could not subscribe you just now. Please try again."); });
    } else {
      location.href = "mailto:" + CFG.business.email + "?subject=" + encodeURIComponent("Subscribe to VANTÉ letters") + "&body=" + encodeURIComponent("Please add " + input.value + " to the VANTÉ mailing list.");
    }
  });

  /* ---------------- Media keys ---------------- */
  // <img data-media="photo-08"> takes its URL from media.js, so swapping a
  // photograph is a one-line change in the manifest.
  $$("img[data-media]").forEach(function (n) {
    if (!n.getAttribute("src")) n.src = img(n.getAttribute("data-media"));
  });

  /* ---------------- Config placeholders in content pages ---------------- */
  $$("[data-cfg]").forEach(function (n) {
    var v = getPath(CFG, n.getAttribute("data-cfg"));
    if (v == null) return;
    if (typeof v === "number") v = V.money(v);
    n.textContent = v;
    if (/^\[\[/.test(String(v))) n.classList.add("placeholder");
  });
  $$("[data-cfg-mail]").forEach(function (n) {
    var v = getPath(CFG, n.getAttribute("data-cfg-mail"));
    if (v) { n.href = "mailto:" + v; if (!n.textContent.trim()) n.textContent = v; }
  });

  /* ---------------- Cart drawer ---------------- */
  var drawer = frag(
    '<aside class="drawer" id="cart" role="dialog" aria-modal="true" aria-labelledby="cart-title" aria-hidden="true">' +
      '<div class="drawer__head"><h2 class="label" id="cart-title">Your bag <span data-cart-count></span></h2>' +
      '<button class="icon-btn" type="button" aria-label="Close bag" data-close-cart>' + ICON.close + "</button></div>" +
      '<div class="drawer__body" data-cart-lines></div>' +
      '<div class="drawer__foot" data-cart-foot></div>' +
    "</aside>"
  );
  body.appendChild(drawer);
  var cartEl = $("#cart");
  var cartBtn = $("[data-open-cart]");
  var countEl = $(".cart-count", cartBtn);

  function shipProgressHTML(sub) {
    var left = V.shipping.remainingForFree(sub);
    var pct = Math.min(1, sub / CFG.freeShippingOver);
    return '<div class="ship-progress">' +
      "<span>" + (left > 0 ? "You are " + esc(V.money(left)) + " away from complimentary standard shipping." : "Your order ships complimentary (standard).") + "</span>" +
      '<div class="ship-progress__bar" aria-hidden="true"><span style="transform:scaleX(' + pct.toFixed(3) + ')"></span></div></div>';
  }
  function lineHTML(l, opts) {
    opts = opts || {};
    return '<div class="line-item" data-sku="' + esc(l.sku) + '">' +
      '<a class="line-item__img" href="' + productUrl(l.product, l.color) + '"><img src="' + esc(l.image) + '" alt="' + esc(l.name + ", " + l.colorName) + '" width="88" height="110" loading="lazy" decoding="async"></a>' +
      "<div>" +
        '<a class="line-item__name" href="' + productUrl(l.product, l.color) + '">' + esc(l.name) + "</a>" +
        '<div class="line-item__meta">' + esc(l.colorName) + " · Size " + esc(l.size) + " · " + esc(V.money(l.unit)) + "</div>" +
        '<div class="qty" role="group" aria-label="Quantity for ' + esc(l.name) + '">' +
          '<button type="button" aria-label="Decrease quantity" data-qty="-1">' + ICON.minus + "</button>" +
          '<input type="number" inputmode="numeric" min="1" max="' + V.cart.MAX_QTY + '" value="' + l.qty + '" aria-label="Quantity" data-qty-input>' +
          '<button type="button" aria-label="Increase quantity" data-qty="1"' + (l.qty >= V.cart.MAX_QTY ? " disabled" : "") + ">" + ICON.plus + "</button>" +
        "</div>" +
        '<div><button type="button" class="line-item__remove" data-remove>Remove</button></div>' +
      "</div>" +
      '<div class="line-item__price">' + esc(V.money(l.total)) + "</div>" +
    "</div>";
  }
  function renderCart() {
    var items = V.cart.detailed();
    var count = V.cart.count();
    var sub = V.cart.subtotal();
    countEl.textContent = count;
    countEl.classList.toggle("has-items", count > 0);
    cartBtn.setAttribute("aria-label", "Bag, " + count + " item" + (count === 1 ? "" : "s"));
    $("[data-cart-count]", cartEl).textContent = count ? "(" + count + ")" : "";
    var linesEl = $("[data-cart-lines]", cartEl), foot = $("[data-cart-foot]", cartEl);
    if (!items.length) {
      linesEl.innerHTML = '<div class="cart-empty"><p class="h3">Your bag is empty.</p><p class="muted">Every piece is printed to order and shipped from our partners.</p><a class="btn" href="shop.html">Explore the collection ' + ICON.arrow + "</a></div>";
      foot.innerHTML = "";
      return;
    }
    linesEl.innerHTML = items.map(function (l) { return lineHTML(l); }).join("");
    foot.innerHTML = shipProgressHTML(sub) +
      '<div class="totals"><div class="totals__row totals__row--grand"><span>Subtotal</span><span>' + esc(V.money(sub)) + "</span></div>" +
      '<p class="muted" style="font-size:12px">Shipping and any import duties are calculated at checkout.</p></div>' +
      '<a class="btn btn--block" href="checkout.html">Checkout ' + ICON.arrow + "</a>";
  }
  function bindLineControls(container) {
    container.addEventListener("click", function (e) {
      var line = e.target.closest("[data-sku]");
      if (!line) return;
      var sku = line.getAttribute("data-sku");
      var qtyBtn = e.target.closest("[data-qty]");
      if (qtyBtn) {
        var cur = V.cart.lines().filter(function (l) { return l.sku === sku; })[0];
        if (cur) V.cart.setQty(sku, cur.qty + parseInt(qtyBtn.getAttribute("data-qty"), 10));
      }
      if (e.target.closest("[data-remove]")) {
        line.classList.add("is-leaving");
        setTimeout(function () { V.cart.remove(sku); }, reduced ? 0 : 380);
      }
    });
    container.addEventListener("change", function (e) {
      if (!e.target.matches("[data-qty-input]")) return;
      var line = e.target.closest("[data-sku]");
      V.cart.setQty(line.getAttribute("data-sku"), e.target.value);
    });
  }
  bindLineControls(cartEl);
  function openCart() { renderCart(); openLayer(cartEl, { focus: "[data-close-cart]" }); }
  cartBtn.addEventListener("click", openCart);
  $("[data-close-cart]", cartEl).addEventListener("click", function () { closeLayer(cartEl); });
  window.addEventListener("vante:cart", function (e) {
    renderCart();
    if (e.detail.reason === "add") { countEl.classList.remove("bump"); void countEl.offsetWidth; countEl.classList.add("bump"); }
  });
  window.addEventListener("storage", function (e) { if (e.key === "vante.cart.v1") location.reload(); });
  renderCart();

  /* Fly a copy of the product image into the bag icon, then open the bag. */
  function flyToCart(fromImg, done) {
    var target = cartBtn.getBoundingClientRect();
    if (!fromImg || reduced || !fromImg.getBoundingClientRect) { if (done) done(); return; }
    var r = fromImg.getBoundingClientRect();
    if (!r.width) { if (done) done(); return; }
    var clone = fromImg.cloneNode(false);
    clone.removeAttribute("loading"); clone.removeAttribute("srcset");
    clone.className = "fly-clone";
    clone.setAttribute("aria-hidden", "true");
    clone.style.cssText = "left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px;";
    body.appendChild(clone);
    var dx = target.left + target.width / 2 - (r.left + r.width / 2);
    var dy = target.top + target.height / 2 - (r.top + r.height / 2);
    var s = Math.max(0.06, 26 / r.width);
    if (window.gsap) {
      window.gsap.timeline({ onComplete: function () { clone.remove(); if (done) done(); } })
        .to(clone, { duration: 0.35, scale: 0.9, ease: "power2.out" })
        .to(clone, { duration: 0.85, x: dx, ease: "power3.inOut" }, 0.2)
        .to(clone, { duration: 0.85, y: dy, scale: s, ease: "back.in(1.2)" }, 0.2)
        .to(clone, { duration: 0.2, opacity: 0 }, 0.9);
    } else {
      clone.animate([{ transform: "none", opacity: 1 }, { transform: "translate(" + dx + "px," + dy + "px) scale(" + s + ")", opacity: 0.2 }],
        { duration: 900, easing: "cubic-bezier(.65,0,.35,1)" }).onfinish = function () { clone.remove(); if (done) done(); };
    }
  }
  function addToCart(id, color, size, qty, fromImg) {
    var line = V.cart.add(id, color, size, qty || 1);
    if (!line) return;
    var p = CAT.product(id);
    flyToCart(fromImg, function () { if (!cartEl.classList.contains("is-open")) openCart(); });
    if (!fromImg || reduced) toast(p.name + " (" + CAT.COLORS[color].name + ", " + size + ") added to your bag.");
  }

  /* ---------------- Product card ---------------- */
  function card(p, opts) {
    opts = opts || {};
    var color = opts.color || p.variants[0].color;
    var v = CAT.variant(p, color), alt = otherColor(p, color);
    var sizes = CAT.sizes(p, v);
    var badge = p.badge ? '<span class="card__badge' + (p.limited ? " card__badge--dark" : "") + '">' + esc(p.badge) + "</span>" : "";
    var swatches = p.variants.map(function (x) {
      var c = CAT.COLORS[x.color];
      return '<button type="button" class="swatch" style="--sw:' + c.hex + '" aria-label="' + esc(c.name) + '" aria-pressed="' + (x.color === color) + '" data-swatch="' + x.color + '"></button>';
    }).join("");
    return '<article class="card' + (opts.className ? " " + opts.className : "") + '" data-card="' + esc(p.id) + '" data-color="' + color + '">' +
      '<div class="card__frame" style="position:relative">' +
        '<a class="card__media" href="' + productUrl(p, color) + '" aria-label="' + esc(p.name + ", " + CAT.COLORS[color].name + ", " + V.money(CAT.price(p, v))) + '">' + badge +
          '<img class="card__img card__img--main" src="' + esc(img(v.images[0])) + '" alt="' + esc(p.name + " in " + CAT.COLORS[color].name.toLowerCase()) + '" width="880" height="1100" loading="lazy" decoding="async">' +
          '<img class="card__img card__img--hover" src="' + esc(img(CAT.variant(p, alt).images[0])) + '" alt="" aria-hidden="true" width="880" height="1100" loading="lazy" decoding="async">' +
        "</a>" +
        '<div class="card__actions">' +
          '<div class="card__sizes" role="group" aria-label="Quick add a size"><span class="card__sizes-label">Quick add</span>' +
            sizes.map(function (s) { return '<button type="button" class="card__size" data-quick-size="' + s + '" aria-label="Add size ' + s + ' to bag">' + s + "</button>"; }).join("") +
          "</div>" +
          '<button type="button" class="card__quick" data-quickview>Quick view</button>' +
        "</div>" +
      "</div>" +
      '<div class="card__info">' +
        '<a class="card__name" href="' + productUrl(p, color) + '" tabindex="-1">' + esc(p.name) + "</a>" +
        '<span class="card__price">' + esc(V.money(CAT.price(p, v))) + "</span>" +
        (opts.line === false ? "" : '<p class="card__line">' + esc(p.line) + "</p>") +
        '<div class="swatches" role="group" aria-label="Colour">' + swatches + "</div>" +
      "</div>" +
    "</article>";
  }
  function setCardColor(cardEl, color) {
    var p = CAT.product(cardEl.getAttribute("data-card"));
    if (!p || cardEl.getAttribute("data-color") === color) return;
    var v = CAT.variant(p, color), alt = CAT.variant(p, otherColor(p, color));
    var main = $(".card__img--main", cardEl), hov = $(".card__img--hover", cardEl);
    cardEl.setAttribute("data-color", color);
    main.classList.add("is-swapping");
    var pre = new Image();
    pre.onload = pre.onerror = function () {
      main.src = img(v.images[0]);
      main.alt = p.name + " in " + CAT.COLORS[color].name.toLowerCase();
      hov.src = img(alt.images[0]);
      requestAnimationFrame(function () { main.classList.remove("is-swapping"); });
    };
    pre.src = img(v.images[0]);
    $$("a", cardEl).forEach(function (a) { if (a.classList.contains("card__media") || a.classList.contains("card__name")) a.href = productUrl(p, color); });
    $$("[data-swatch]", cardEl).forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-swatch") === color)); });
  }
  doc.addEventListener("click", function (e) {
    var cardEl = e.target.closest("[data-card]");
    if (!cardEl) return;
    var sw = e.target.closest("[data-swatch]");
    if (sw) { e.preventDefault(); setCardColor(cardEl, sw.getAttribute("data-swatch")); return; }
    var qs = e.target.closest("[data-quick-size]");
    if (qs) {
      e.preventDefault();
      addToCart(cardEl.getAttribute("data-card"), cardEl.getAttribute("data-color"), qs.getAttribute("data-quick-size"), 1, $(".card__img--main", cardEl));
      return;
    }
    if (e.target.closest("[data-quickview]")) { e.preventDefault(); quickView(cardEl.getAttribute("data-card"), cardEl.getAttribute("data-color")); }
  });
  /* Touch devices get no hover image: swap on swatch only (handled above). */

  /* ---------------- Option picker (colour, size, quantity, add) ---------------- */
  // Shared by quick view, the home reveal, the limited drop and the product page.
  var pickerSeq = 0;
  function picker(container, p, opts) {
    opts = opts || {};
    var id = "pk" + (++pickerSeq);
    var state = { color: opts.color && CAT.variant(p, opts.color).color === opts.color ? opts.color : p.variants[0].color, size: null, qty: 1 };
    function sizesFor() { return CAT.sizes(p, CAT.variant(p, state.color)); }
    container.innerHTML =
      '<div class="option" data-opt-color><div class="option__head"><span class="label" id="' + id + '-c">Colour — <span data-color-name>' + esc(CAT.COLORS[state.color].name) + "</span></span></div>" +
        '<div class="swatches" role="radiogroup" aria-labelledby="' + id + '-c">' +
          p.variants.map(function (x) {
            var c = CAT.COLORS[x.color];
            return '<button type="button" role="radio" class="swatch swatch--large" style="--sw:' + c.hex + '" aria-label="' + esc(c.name) + '" aria-checked="' + (x.color === state.color) + '" data-pick-color="' + x.color + '"></button>';
          }).join("") +
        "</div></div>" +
      '<div class="option" data-opt-size><div class="option__head"><span class="label" id="' + id + '-s">Size</span>' +
        (opts.sizeGuide !== false ? '<a class="label link-underline" href="faq.html#size-guide">Size guide</a>' : "") + "</div>" +
        '<div class="sizes" role="radiogroup" aria-labelledby="' + id + '-s" data-size-list></div>' +
        '<p class="option__error" role="alert" data-size-error hidden>Please choose a size.</p></div>' +
      '<div class="pdp__buy">' +
        (opts.qty ? '<div class="qty qty--large" role="group" aria-label="Quantity"><button type="button" aria-label="Decrease quantity" data-pq="-1">' + ICON.minus + '</button><input type="number" min="1" max="' + V.cart.MAX_QTY + '" value="1" aria-label="Quantity" data-pq-input><button type="button" aria-label="Increase quantity" data-pq="1">' + ICON.plus + "</button></div>" : "") +
        '<button type="button" class="btn' + (opts.dark ? " btn--light" : "") + (opts.qty ? "" : " btn--block") + '" data-add><span class="btn__text">Add to bag — <span data-add-price>' + esc(V.money(CAT.price(p, CAT.variant(p, state.color)))) + "</span></span></button>" +
        (opts.buyNow ? '<button type="button" class="btn btn--ghost btn--block" data-buy-now>Buy now</button>' : "") +
      "</div>";

    var sizeList = $("[data-size-list]", container);
    function renderSizes() {
      var sizes = sizesFor();
      if (state.size && sizes.indexOf(state.size) === -1) state.size = null;
      sizeList.innerHTML = sizes.map(function (s) {
        return '<button type="button" role="radio" class="size-btn" aria-checked="' + (s === state.size) + '" data-pick-size="' + s + '">' + s + "</button>";
      }).join("");
    }
    renderSizes();
    function setColor(c) {
      if (c === state.color) return;
      state.color = c;
      $$("[data-pick-color]", container).forEach(function (b) { b.setAttribute("aria-checked", String(b.getAttribute("data-pick-color") === c)); });
      $("[data-color-name]", container).textContent = CAT.COLORS[c].name;
      $("[data-add-price]", container).textContent = V.money(CAT.price(p, CAT.variant(p, c)));
      renderSizes();
      if (opts.onColor) opts.onColor(c);
    }
    function validate() {
      var ok = !!state.size;
      var opt = $("[data-opt-size]", container);
      opt.classList.toggle("is-error", !ok);
      $("[data-size-error]", container).hidden = ok;
      if (!ok) { setTimeout(function () { opt.classList.remove("is-error"); }, 500); var f = $("[data-pick-size]", container); if (f) f.focus(); }
      return ok;
    }
    container.addEventListener("click", function (e) {
      var c = e.target.closest("[data-pick-color]");
      if (c) { setColor(c.getAttribute("data-pick-color")); return; }
      var s = e.target.closest("[data-pick-size]");
      if (s) {
        state.size = s.getAttribute("data-pick-size");
        $$("[data-pick-size]", container).forEach(function (b) { b.setAttribute("aria-checked", String(b === s)); });
        $("[data-size-error]", container).hidden = true;
        if (opts.onSize) opts.onSize(state.size);
        return;
      }
      var q = e.target.closest("[data-pq]");
      if (q) {
        state.qty = Math.max(1, Math.min(V.cart.MAX_QTY, state.qty + parseInt(q.getAttribute("data-pq"), 10)));
        $("[data-pq-input]", container).value = state.qty;
        return;
      }
      if (e.target.closest("[data-add]")) {
        if (!validate()) return;
        addToCart(p.id, state.color, state.size, state.qty, opts.flyFrom ? opts.flyFrom() : null);
        if (opts.onAdd) opts.onAdd(state);
        return;
      }
      if (e.target.closest("[data-buy-now]")) {
        if (!validate()) return;
        V.cart.add(p.id, state.color, state.size, state.qty);
        location.href = "checkout.html";
      }
    });
    // Arrow keys inside radiogroups, as the ARIA pattern expects.
    container.addEventListener("keydown", function (e) {
      var r = e.target.closest('[role="radio"]');
      if (!r || ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].indexOf(e.key) === -1) return;
      var group = $$('[role="radio"]', r.parentNode), i = group.indexOf(r);
      var n = group[(i + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + group.length) % group.length];
      e.preventDefault(); n.focus(); n.click();
    });
    container.addEventListener("change", function (e) {
      if (e.target.matches("[data-pq-input]")) {
        state.qty = Math.max(1, Math.min(V.cart.MAX_QTY, parseInt(e.target.value, 10) || 1));
        e.target.value = state.qty;
      }
    });
    return { state: state, setColor: setColor, validate: validate };
  }

  /* Swap an <img> to another source with a soft cross-fade. */
  function swapImage(imgEl, src, alt) {
    if (!imgEl || imgEl.getAttribute("src") === src) return;
    imgEl.classList.add("is-out");
    var pre = new Image();
    pre.onload = pre.onerror = function () {
      setTimeout(function () {
        imgEl.src = src; if (alt) imgEl.alt = alt;
        requestAnimationFrame(function () { imgEl.classList.remove("is-out"); });
      }, reduced ? 0 : 260);
    };
    pre.src = src;
  }

  /* ---------------- Quick view ---------------- */
  var qv = frag(
    '<div class="modal" id="quickview" role="dialog" aria-modal="true" aria-labelledby="qv-title" aria-hidden="true">' +
      '<div class="modal__panel"><button class="icon-btn modal__close" type="button" aria-label="Close quick view" data-close-qv>' + ICON.close + "</button>" +
      '<div class="quickview"><div class="quickview__media"><img alt="" data-qv-img width="880" height="1100"></div>' +
      '<div class="quickview__info"><p class="label muted" data-qv-kicker></p><h2 class="h3" id="qv-title" data-qv-name></h2><p class="lead" data-qv-line></p>' +
      '<div data-qv-picker style="display:grid;gap:24px"></div><a class="label link-underline" data-qv-link href="#">View full details</a></div></div></div>' +
    "</div>"
  );
  body.appendChild(qv);
  var qvEl = $("#quickview");
  qvEl.addEventListener("click", function (e) { if (e.target === qvEl) closeLayer(qvEl); });
  $("[data-close-qv]", qvEl).addEventListener("click", function () { closeLayer(qvEl); });
  function quickView(id, color) {
    var p = CAT.product(id);
    if (!p) return;
    var image = $("[data-qv-img]", qvEl);
    var v = CAT.variant(p, color);
    image.src = img(v.images[0]);
    image.alt = p.name + " in " + CAT.COLORS[v.color].name.toLowerCase();
    $("[data-qv-kicker]", qvEl).textContent = (p.collections.map(function (c) { return CAT.COLLECTIONS[c].name; })[0] || "") + (p.limited ? " · " + p.limited.label : "");
    $("[data-qv-name]", qvEl).textContent = p.name;
    $("[data-qv-line]", qvEl).textContent = p.line;
    var link = $("[data-qv-link]", qvEl);
    link.href = productUrl(p, v.color);
    picker($("[data-qv-picker]", qvEl), p, {
      color: v.color, qty: true, flyFrom: function () { return image; },
      onColor: function (c) { swapImage(image, img(CAT.variant(p, c).images[0]), p.name + " in " + CAT.COLORS[c].name.toLowerCase()); link.href = productUrl(p, c); },
      onAdd: function () { closeLayer(qvEl); }
    });
    openLayer(qvEl, { focus: "[data-close-qv]" });
  }

  /* ---------------- Search ---------------- */
  var searchFrag = frag(
    '<div class="search" id="search" role="dialog" aria-modal="true" aria-label="Search the store" aria-hidden="true">' +
      '<button class="icon-btn search__close" type="button" aria-label="Close search" data-close-search>' + ICON.close + "</button>" +
      '<form class="search__field" role="search" action="shop.html">' + ICON.search +
        '<label class="sr-only" for="search-input">Search</label>' +
        '<input id="search-input" type="search" name="q" placeholder="Search pieces" autocomplete="off" aria-controls="search-results" aria-describedby="search-status">' +
      "</form>" +
      '<div class="search__meta"><span class="label muted" id="search-status" aria-live="polite">Try</span>' +
        ["Archangel", "Hoodie", "Monogram", "Celestial", "Shorts", "White"].map(function (t) { return '<button type="button" class="chip" data-suggest="' + t + '">' + t + "</button>"; }).join("") +
      "</div>" +
      '<div class="search__results" id="search-results" role="listbox" aria-label="Results"></div>' +
    "</div>"
  );
  body.appendChild(searchFrag);
  var searchEl = $("#search"), searchInput = $("#search-input"), results = $("#search-results"), status = $("#search-status");
  function haystack(p) {
    return [p.name, p.line, p.description, CAT.CATEGORIES[p.category], p.badge || "",
      p.collections.map(function (c) { return CAT.COLLECTIONS[c].name; }).join(" "),
      p.variants.map(function (v) { return CAT.COLORS[v.color].name; }).join(" ")].join(" ").toLowerCase();
  }
  function searchProducts(q) {
    var terms = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return CAT.PRODUCTS.map(function (p) {
      var h = haystack(p), score = 0;
      for (var i = 0; i < terms.length; i++) {
        if (h.indexOf(terms[i]) === -1) return null;
        score += p.name.toLowerCase().indexOf(terms[i]) !== -1 ? 3 : 1;
      }
      return { p: p, score: score };
    }).filter(Boolean).sort(function (a, b) { return b.score - a.score; }).map(function (x) { return x.p; });
  }
  var activeHit = -1;
  function colorFromQuery(q) { return /\bwhite\b/i.test(q) ? "white" : /\bblack\b/i.test(q) ? "black" : null; }
  function runSearch() {
    var q = searchInput.value;
    var hits = searchProducts(q);
    activeHit = -1;
    var color = colorFromQuery(q);
    if (!q.trim()) { results.innerHTML = ""; status.textContent = "Try"; return; }
    status.textContent = hits.length ? hits.length + " piece" + (hits.length === 1 ? "" : "s") : "Nothing found";
    results.innerHTML = hits.length ? hits.map(function (p, i) {
      var v = CAT.variant(p, color || p.variants[0].color);
      return '<a class="search-hit" role="option" id="hit-' + i + '" aria-selected="false" href="' + productUrl(p, v.color) + '">' +
        '<span class="search-hit__img"><img src="' + esc(img(v.images[0])) + '" alt="" width="880" height="1100" loading="lazy"></span>' +
        '<span class="card__info"><span class="card__name">' + esc(p.name) + '</span><span class="card__price">' + esc(V.money(p.price)) + "</span></span></a>";
    }).join("") : '<p class="search__empty">No pieces match “' + esc(q) + '”. Try a name, a colour or a collection.</p>';
  }
  var searchTimer;
  searchInput.addEventListener("input", function () { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 90); });
  searchInput.addEventListener("keydown", function (e) {
    var hits = $$(".search-hit", results);
    if (!hits.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      activeHit = (activeHit + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
      hits.forEach(function (h, i) { h.classList.toggle("is-active", i === activeHit); h.setAttribute("aria-selected", String(i === activeHit)); });
      searchInput.setAttribute("aria-activedescendant", hits[activeHit].id);
    } else if (e.key === "Enter" && activeHit > -1) {
      e.preventDefault(); location.href = hits[activeHit].href;
    }
  });
  $$("[data-suggest]", searchEl).forEach(function (b) { b.addEventListener("click", function () { searchInput.value = b.getAttribute("data-suggest"); runSearch(); searchInput.focus(); }); });
  function openSearch() { openLayer(searchEl, { scrim: false, focus: "#search-input" }); }
  $$("[data-open-search]").forEach(function (b) { b.addEventListener("click", openSearch); });
  $("[data-close-search]", searchEl).addEventListener("click", function () { closeLayer(searchEl); });
  doc.addEventListener("keydown", function (e) {
    if (e.key === "/" && !openLayers.length && !/input|textarea|select/i.test(doc.activeElement.tagName)) { e.preventDefault(); openSearch(); }
  });

  /* ---------------- Cookie consent ---------------- */
  var consentFrag = frag(
    '<div class="consent" id="consent" role="region" aria-label="Cookie consent">' +
      '<p class="label">Your privacy</p>' +
      '<p>We use strictly necessary storage to keep your bag and preferences working. With your permission we would also use analytics and marketing cookies — none are active until you choose. Read our <a href="cookies.html">Cookie Policy</a>.</p>' +
      '<div class="consent__actions">' +
        '<button type="button" class="btn btn--light" data-consent="all">Accept all</button>' +
        '<button type="button" class="btn btn--ghost-light" data-consent="none">Reject non-essential</button>' +
        '<button type="button" class="btn btn--ghost-light" data-consent="prefs">Preferences</button>' +
      "</div>" +
    "</div>" +
    '<div class="modal modal--small" id="consent-prefs" role="dialog" aria-modal="true" aria-labelledby="cp-title" aria-hidden="true">' +
      '<div class="modal__panel"><button class="icon-btn modal__close" type="button" aria-label="Close" data-close-cp>' + ICON.close + "</button>" +
      '<h2 class="h3" id="cp-title">Cookie preferences</h2>' +
      '<p class="muted" style="margin-top:12px;font-size:var(--fs-small)">Choose what you allow. You can change this at any time from “Cookie settings” in the footer.</p>' +
      '<div class="consent-prefs">' +
        consentRow("necessary", "Strictly necessary", "Your bag, saved pieces, this consent choice and checkout. Always on — the store cannot work without them.", true) +
        consentRow("preferences", "Preferences", "Remembers choices such as your last shipping country.") +
        consentRow("analytics", "Analytics", "Anonymous measurement of how the site is used. Not in use today; enabled only with your consent.") +
        consentRow("marketing", "Marketing", "Measures campaigns and personalises ads on other platforms. Not in use today; enabled only with your consent.") +
      "</div>" +
      '<div class="consent__actions" style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn" data-consent="save">Save choices</button><button type="button" class="btn btn--ghost" data-consent="all">Accept all</button></div>' +
      "</div>" +
    "</div>"
  );
  function consentRow(key, title, text, locked) {
    return '<div class="toggle-row"><label class="label" for="cc-' + key + '">' + title + "</label>" +
      '<span class="switch"><input type="checkbox" id="cc-' + key + '" data-cc="' + key + '"' + (locked ? " checked disabled" : "") + "><span></span></span>" +
      "<p>" + text + "</p></div>";
  }
  body.appendChild(consentFrag);
  var consentEl = $("#consent"), prefsEl = $("#consent-prefs");
  function syncPrefs() {
    var c = V.consent.get() || {};
    $$("[data-cc]", prefsEl).forEach(function (i) { if (!i.disabled) i.checked = !!c[i.getAttribute("data-cc")]; });
  }
  function openPrefs() { syncPrefs(); openLayer(prefsEl, { focus: "[data-close-cp]" }); }
  function decide(kind) {
    if (kind === "prefs") { openPrefs(); return; }
    if (kind === "all") V.consent.set({ preferences: true, analytics: true, marketing: true });
    else if (kind === "none") V.consent.set({});
    else if (kind === "save") {
      var ch = {};
      $$("[data-cc]", prefsEl).forEach(function (i) { ch[i.getAttribute("data-cc")] = i.checked; });
      V.consent.set(ch);
    }
    consentEl.classList.remove("is-open");
    if (prefsEl.classList.contains("is-open")) closeLayer(prefsEl);
    toast("Your cookie choices are saved.");
  }
  doc.addEventListener("click", function (e) {
    var b = e.target.closest("[data-consent]");
    if (b) { decide(b.getAttribute("data-consent")); return; }
    if (e.target.closest("[data-consent-settings]")) openPrefs();
  });
  $("[data-close-cp]", prefsEl).addEventListener("click", function () { closeLayer(prefsEl); });
  prefsEl.addEventListener("click", function (e) { if (e.target === prefsEl) closeLayer(prefsEl); });
  if (!V.consent.get()) setTimeout(function () { consentEl.classList.add("is-open"); }, 1600);

  /* ---------------- Page transitions ---------------- */
  var veil = doc.createElement("div");
  veil.className = "veil";
  veil.setAttribute("aria-hidden", "true");
  body.appendChild(veil);
  doc.addEventListener("click", function (e) {
    var a = e.target.closest("a[href]");
    if (!a || reduced || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (a.target && a.target !== "_self") return;
    var href = a.getAttribute("href");
    if (!href || href.charAt(0) === "#" || /^(mailto|tel|javascript):/i.test(href) || a.hasAttribute("download")) return;
    var url;
    try { url = new URL(a.href, location.href); } catch (err) { return; }
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
    e.preventDefault();
    veil.classList.add("is-leaving");
    setTimeout(function () { location.href = url.href; }, 560);
  });
  window.addEventListener("pageshow", function (e) { if (e.persisted) veil.classList.remove("is-leaving"); });

  /* ---------------- Loader (first visit of the session, home only) ---------------- */
  function runLoader(done) {
    var seen = false;
    try { seen = sessionStorage.getItem("vante.seen") === "1"; sessionStorage.setItem("vante.seen", "1"); } catch (e) { seen = true; }
    if (seen || reduced || !window.gsap || !body.hasAttribute("data-loader")) { done(); return; }
    var l = frag('<div class="loader" aria-hidden="true"><div class="loader__word wordmark"><span>Vanté</span></div><div class="loader__bar"></div></div>');
    body.appendChild(l);
    var el = $(".loader");
    var g = window.gsap;
    g.timeline({ onComplete: function () { el.remove(); } })
      .from(".loader__word span", { yPercent: 110, duration: 1, ease: "power4.out" })
      .to(".loader__bar", { scaleX: 1, duration: 1.1, ease: "power2.inOut" }, 0.2)
      .to(".loader__word span", { yPercent: -110, duration: 0.7, ease: "power3.in" }, 1.25)
      .add(done, 1.45)
      .to(el, { clipPath: "inset(0 0 100% 0)", duration: 1, ease: "expo.inOut" }, 1.45);
  }

  /* ---------------- Cursor ---------------- */
  if (finePointer && !reduced) {
    var cur = doc.createElement("div");
    cur.className = "cursor"; cur.setAttribute("aria-hidden", "true");
    body.appendChild(cur);
    var cx = 0, cy = 0, tx = 0, ty = 0;
    doc.addEventListener("mousemove", function (e) { tx = e.clientX; ty = e.clientY; cur.classList.add("is-visible"); }, { passive: true });
    doc.addEventListener("mouseleave", function () { cur.classList.remove("is-visible"); });
    doc.addEventListener("mouseover", function (e) { cur.classList.toggle("is-hover", !!e.target.closest("a, button, [data-cursor]")); });
    (function loop() { cx += (tx - cx) * 0.2; cy += (ty - cy) * 0.2; cur.style.transform = "translate(" + cx + "px," + cy + "px)"; requestAnimationFrame(loop); })();
  }

  /* ---------------- Generic motion ---------------- */
  // Split [data-split] headings into masked lines (keeps text for screen readers).
  function splitLines(el) {
    if (el.getAttribute("data-split-done")) return $$(".split-line > span", el);
    var label = el.textContent.replace(/\s+/g, " ").trim();
    var parts = el.innerHTML.split(/<br\s*\/?>/i);
    el.innerHTML = parts.map(function (h) { return '<span class="split-line" aria-hidden="true"><span>' + h.trim() + "</span></span>"; }).join("");
    el.setAttribute("aria-label", label);
    el.setAttribute("data-split-done", "1");
    return $$(".split-line > span", el);
  }
  function splitWords(el) {
    var text = el.textContent.trim(), words = text.split(/\s+/);
    el.innerHTML = '<span class="sr-only">' + esc(text) + "</span>" +
      words.map(function (w) { return '<span class="word" aria-hidden="true">' + esc(w) + "</span>"; }).join(" ");
    return $$(".word", el);
  }
  function initMotion(scope) {
    scope = scope || doc;
    if (!hasGSAP) {
      $$(".fade-up, .reveal-clip", scope).forEach(function (n) { n.style.opacity = 1; n.style.transform = "none"; n.style.clipPath = "none"; });
      return;
    }
    var g = window.gsap;
    $$("[data-split]", scope).forEach(function (el) {
      var lines = splitLines(el);
      g.from(lines, { yPercent: 105, duration: 1.3, ease: "power4.out", stagger: 0.09, scrollTrigger: { trigger: el, start: "top 88%" } });
    });
    $$(".fade-up", scope).forEach(function (el) {
      g.to(el, { opacity: 1, y: 0, duration: 1.2, ease: "power3.out", delay: parseFloat(el.getAttribute("data-delay") || 0), scrollTrigger: { trigger: el, start: "top 90%" } });
    });
    $$(".reveal-clip", scope).forEach(function (el) {
      var im = $("img", el);
      var tl = g.timeline({ scrollTrigger: { trigger: el, start: "top 85%" } });
      tl.fromTo(el, { clipPath: "inset(100% 0% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 1.4, ease: "expo.inOut" });
      if (im) tl.from(im, { scale: 1.3, duration: 1.8, ease: "expo.out" }, 0.1);
    });
    $$("[data-parallax]", scope).forEach(function (el) {
      var amt = parseFloat(el.getAttribute("data-parallax")) || 12;
      g.fromTo(el, { yPercent: -amt / 2 }, { yPercent: amt / 2, ease: "none", scrollTrigger: { trigger: el.parentNode, start: "top bottom", end: "bottom top", scrub: true } });
    });
  }

  function onReady(fn) {
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  window.VANTE_UI = {
    $: $, $$: $$, esc: esc, frag: frag, param: param, img: img, ICON: ICON, reduced: reduced, hasGSAP: hasGSAP,
    lenis: function () { return lenis; }, scrollToEl: scrollToEl,
    card: card, setCardColor: setCardColor, picker: picker, swapImage: swapImage, quickView: quickView,
    addToCart: addToCart, flyToCart: flyToCart, openCart: openCart, toast: toast,
    openLayer: openLayer, closeLayer: closeLayer, lineHTML: lineHTML, bindLineControls: bindLineControls,
    shipProgressHTML: shipProgressHTML, productUrl: productUrl, otherColor: otherColor,
    splitLines: splitLines, splitWords: splitWords, initMotion: initMotion, runLoader: runLoader, onReady: onReady
  };

  // Pages without their own script still get the generic motion.
  if (!body.hasAttribute("data-custom-motion")) onReady(function () { initMotion(); });
})();
