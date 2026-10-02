/*
 * VANTÉ — product page. Reads ?id= and ?color=, renders gallery, options,
 * details and related pieces. Colour changes swap imagery and the URL with no
 * reload.
 */
(function () {
  "use strict";
  var V = window.VANTE, CAT = V.catalog, CFG = V.config, UI = window.VANTE_UI;
  var $ = UI.$, $$ = UI.$$, esc = UI.esc;

  var p = CAT.product(UI.param("id") || "");
  if (!p) { location.replace("404.html"); return; }
  var color = CAT.variant(p, UI.param("color") || p.variants[0].color).color;

  document.title = p.name + " — VANTÉ";
  var md = document.querySelector('meta[name="description"]');
  if (md) md.setAttribute("content", p.line + " " + p.description);

  var heroBox = $("[data-pdp-hero]"), hero = $("[data-pdp-img]");
  function altFor(c) { return p.name + " in " + CAT.COLORS[c].name.toLowerCase(); }
  hero.src = UI.img(CAT.variant(p, color).images[0]);
  hero.alt = altFor(color);

  /* ---------- Text ---------- */
  var coll = CAT.COLLECTIONS[p.collections[0]];
  $("[data-crumbs]").innerHTML = '<a href="shop.html">Shop</a><span aria-hidden="true">/</span><a href="shop.html?collection=' + p.collections[0] + '">' + esc(coll.name) + '</a><span aria-hidden="true">/</span><span aria-current="page">' + esc(p.name) + "</span>";
  $("[data-pdp-kicker]").textContent = CAT.CATEGORIES[p.category] + (p.badge ? " · " + p.badge : "");
  $("[data-pdp-name]").textContent = p.name;
  $("[data-pdp-price]").textContent = V.money(p.price);
  $("[data-pdp-limited]").textContent = p.limited ? p.limited.label : "";
  $("[data-pdp-line]").textContent = p.line;

  /* ---------- Thumbs: both colourways + editorial ---------- */
  var thumbs = $("[data-pdp-thumbs]");
  function renderThumbs() {
    thumbs.innerHTML = p.variants.map(function (v) {
      return '<button type="button" class="pdp__thumb" aria-label="Show ' + esc(CAT.COLORS[v.color].name) + '" aria-current="' + (v.color === color) + '" data-thumb="' + v.color + '"><img src="' + esc(UI.img(v.images[0])) + '" alt="" width="84" height="105" loading="lazy"></button>';
    }).join("");
  }
  renderThumbs();
  thumbs.addEventListener("click", function (e) {
    var t = e.target.closest("[data-thumb]");
    if (t) pick.setColor(t.getAttribute("data-thumb"));
  });
  $("[data-pdp-editorial]").innerHTML = (p.editorial || []).map(function (k) {
    return '<div class="media reveal-clip"><img src="' + esc(UI.img(k)) + '" alt="VANTÉ campaign photograph" width="900" height="1200" loading="lazy" decoding="async"></div>';
  }).join("");

  /* Zoom: click or Enter toggles, pointer pans. */
  function toggleZoom() {
    var z = heroBox.classList.toggle("is-zoomed");
    heroBox.setAttribute("aria-label", z ? "Zoom out" : "Zoom image");
    if (!z) hero.style.transformOrigin = "";
  }
  heroBox.addEventListener("click", toggleZoom);
  heroBox.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleZoom(); } });
  heroBox.addEventListener("mousemove", function (e) {
    if (!heroBox.classList.contains("is-zoomed")) return;
    var r = heroBox.getBoundingClientRect();
    hero.style.transformOrigin = ((e.clientX - r.left) / r.width * 100) + "% " + ((e.clientY - r.top) / r.height * 100) + "%";
  });
  heroBox.addEventListener("mouseleave", function () { if (heroBox.classList.contains("is-zoomed")) toggleZoom(); });

  /* ---------- Options ---------- */
  var pick = UI.picker($("[data-pdp-picker]"), p, {
    color: color, qty: true, buyNow: true, flyFrom: function () { return hero; },
    onColor: function (c) {
      color = c;
      UI.swapImage(hero, UI.img(CAT.variant(p, c).images[0]), altFor(c));
      renderThumbs();
      history.replaceState(null, "", "product.html?id=" + encodeURIComponent(p.id) + "&color=" + c);
    },
    onSize: function (s) { stickyBtn.textContent = "Add to bag — " + s; }
  });

  /* ---------- Saved ---------- */
  var wishBtn = $("[data-wish]");
  function syncWish() {
    var on = V.wish.has(p.id);
    wishBtn.setAttribute("aria-pressed", String(on));
    wishBtn.innerHTML = UI.ICON.heart + "<span>" + (on ? "Saved" : "Save for later") + "</span>";
  }
  wishBtn.addEventListener("click", function () {
    var on = V.wish.toggle(p.id);
    syncWish();
    UI.toast(on ? p.name + " saved to your account page." : p.name + " removed from saved.");
  });
  syncWish();

  /* ---------- Notes & accordion ---------- */
  var zones = CFG.shipping.map(function (z) { return z.name; }).join(", ").replace(/, ([^,]*)$/, " and $1");
  $("[data-pdp-notes]").innerHTML = [
    "Printed to order — ships in " + CFG.processingDays,
    "Complimentary standard shipping over " + V.money(CFG.freeShippingOver),
    "Returns within " + CFG.returnsWindowDays + " days of delivery"
  ].map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("");

  var sp = p.spec;
  function acc(title, html, open) {
    return '<div class="acc"><button class="acc__btn" type="button" aria-expanded="' + !!open + '">' + title + '<span class="plus" aria-hidden="true"></span></button>' +
      '<div class="acc__panel"><div><div class="acc__content">' + html + "</div></div></div></div>";
  }
  $("[data-pdp-acc]").innerHTML =
    acc("Description", "<p>" + esc(p.description) + "</p>" + (p.limited ? "<p>" + esc(p.limited.label) + ". Produced once; not restocked.</p>" : ""), true) +
    acc("Material &amp; fit", "<p>" + esc(sp.material) + "</p><p>" + esc(sp.fit) + '</p><p><a class="link-underline" href="faq.html#size-guide">Size guide</a></p>') +
    acc("Details &amp; care", "<ul>" + sp.details.map(function (d) { return "<li>" + esc(d) + "</li>"; }).join("") + "</ul><ul>" + CAT.CARE.map(function (d) { return "<li>" + esc(d) + "</li>"; }).join("") + "</ul>") +
    acc("Shipping &amp; returns", "<p>Ships to " + esc(zones) + ". Production takes " + esc(CFG.processingDays) + ", then delivery by the method you choose at checkout. Orders outside the United States are shipped Delivered Duty Unpaid.</p><p><a class=\"link-underline\" href=\"shipping.html\">Shipping policy</a> · <a class=\"link-underline\" href=\"returns.html\">Returns &amp; cancellations</a></p>");

  /* ---------- Related ---------- */
  var related = CAT.PRODUCTS.filter(function (x) { return x.id !== p.id && x.collections.some(function (c) { return p.collections.indexOf(c) !== -1; }); });
  CAT.PRODUCTS.forEach(function (x) { if (x.id !== p.id && related.indexOf(x) === -1) related.push(x); });
  $("[data-related]").innerHTML = related.slice(0, 4).map(function (x, i) { return UI.card(x, { color: i % 2 ? "white" : "black", className: "fade-up" }); }).join("");

  /* ---------- Sticky buy bar (mobile) ---------- */
  var sticky = $("[data-sticky-buy]"), stickyBtn = $("[data-sticky-add]");
  $("[data-sticky-name]").textContent = p.name + " · " + V.money(p.price);
  var addBtn = $("[data-add]");
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (en) {
      var on = !en[0].isIntersecting && en[0].boundingClientRect.top < 0;
      sticky.classList.toggle("is-on", on);
      sticky.setAttribute("aria-hidden", String(!on));
      stickyBtn.tabIndex = on ? 0 : -1;
    }).observe(addBtn);
  }
  stickyBtn.addEventListener("click", function () {
    if (!pick.state.size) { UI.scrollToEl($("[data-pdp-picker]")); setTimeout(pick.validate, 500); return; }
    addBtn.click();
  });

  /* ---------- Structured data for search engines ---------- */
  var ld = document.createElement("script");
  ld.type = "application/ld+json";
  ld.textContent = JSON.stringify({
    "@context": "https://schema.org", "@type": "ProductGroup", name: p.name, description: p.description,
    brand: { "@type": "Brand", name: "VANTÉ" }, productGroupID: p.id, variesBy: ["https://schema.org/color", "https://schema.org/size"],
    hasVariant: p.variants.map(function (v) {
      return { "@type": "Product", name: p.name + " — " + CAT.COLORS[v.color].name, color: CAT.COLORS[v.color].name, image: UI.img(v.images[0]),
        offers: { "@type": "Offer", price: CAT.price(p, v), priceCurrency: CFG.currency, availability: "https://schema.org/MadeToOrder" } };
    })
  });
  document.head.appendChild(ld);

  UI.initMotion();
})();
