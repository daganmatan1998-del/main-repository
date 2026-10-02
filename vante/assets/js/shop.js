/*
 * VANTÉ — shop / collection listing.
 * Filters live in the URL (?category=, ?collection=, ?color=, ?filter=new,
 * ?sort=, ?q=) so every view is linkable and the back button works.
 */
(function () {
  "use strict";
  var V = window.VANTE, CAT = V.catalog, UI = window.VANTE_UI;
  var $ = UI.$, $$ = UI.$$, esc = UI.esc;

  var state = {
    category: UI.param("category") || "",
    collection: UI.param("collection") || "",
    color: UI.param("color") || "",
    filter: UI.param("filter") || "",
    sort: UI.param("sort") || "featured",
    q: UI.param("q") || ""
  };
  if (state.category && !CAT.CATEGORIES[state.category]) state.category = "";
  if (state.collection && !CAT.COLLECTIONS[state.collection]) state.collection = "";
  if (state.color && !CAT.COLORS[state.color]) state.color = "";

  var grid = $("[data-shop-grid]");
  var countEl = $("[data-count]");

  /* ---------- Controls ---------- */
  var chipsEl = $("[data-chips]");
  chipsEl.innerHTML = '<button type="button" class="chip" data-cat="">All</button>' +
    Object.keys(CAT.CATEGORIES).map(function (k) { return '<button type="button" class="chip" data-cat="' + k + '">' + esc(CAT.CATEGORIES[k]) + "</button>"; }).join("") +
    '<span aria-hidden="true" style="width:1px;background:var(--line);margin:0 6px"></span>' +
    Object.keys(CAT.COLORS).map(function (k) {
      return '<button type="button" class="chip" data-colorf="' + k + '"><span class="swatch" style="--sw:' + CAT.COLORS[k].hex + ';width:12px;height:12px;margin-right:8px" aria-hidden="true"></span>' + esc(CAT.COLORS[k].name) + "</button>";
    }).join("");

  var collSel = $("[data-collection]");
  collSel.innerHTML = '<option value="">All collections</option>' + Object.keys(CAT.COLLECTIONS).map(function (k) {
    return '<option value="' + k + '">' + esc(CAT.COLLECTIONS[k].name) + "</option>";
  }).join("");
  var sortSel = $("[data-sort]");

  function syncControls() {
    $$("[data-cat]", chipsEl).forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-cat") === state.category)); });
    $$("[data-colorf]", chipsEl).forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-colorf") === state.color)); });
    collSel.value = state.collection;
    sortSel.value = state.sort;
  }

  /* ---------- Heading follows the view ---------- */
  function heading() {
    var kicker = "The collection", title = "All pieces", text = "Every design in black and white, printed to order on heavyweight cotton.";
    if (state.filter === "new") { kicker = "Just arrived"; title = "New arrivals"; text = "Four new studies for the season — Icarus, Atlas and two crewnecks for every day."; }
    if (state.collection) { var c = CAT.COLLECTIONS[state.collection]; kicker = c.kicker; title = c.name; text = c.description; }
    if (state.category) { title = state.collection || state.filter ? title + " — " + CAT.CATEGORIES[state.category] : CAT.CATEGORIES[state.category]; }
    if (state.q) { kicker = "Search"; title = "“" + state.q + "”"; text = "Pieces matching your search."; }
    $("[data-kicker]").textContent = kicker;
    $("[data-title]").textContent = title;
    $("[data-text]").textContent = text;
    document.title = title.replace(/[“”]/g, "") + " — VANTÉ";
  }

  /* ---------- Query ---------- */
  function results() {
    var terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    var list = CAT.PRODUCTS.filter(function (p) {
      if (state.category && p.category !== state.category) return false;
      if (state.collection && p.collections.indexOf(state.collection) === -1) return false;
      if (state.filter === "new" && p.origin !== "new") return false;
      if (state.color && !p.variants.some(function (v) { return v.color === state.color; })) return false;
      if (terms.length) {
        var h = (p.name + " " + p.line + " " + p.description + " " + CAT.CATEGORIES[p.category]).toLowerCase();
        if (!terms.every(function (t) { return h.indexOf(t) !== -1; })) return false;
      }
      return true;
    });
    var order = CAT.PRODUCTS.map(function (p) { return p.id; });
    var sorters = {
      featured: function (a, b) { return order.indexOf(a.id) - order.indexOf(b.id); },
      "price-asc": function (a, b) { return a.price - b.price || order.indexOf(a.id) - order.indexOf(b.id); },
      "price-desc": function (a, b) { return b.price - a.price || order.indexOf(a.id) - order.indexOf(b.id); },
      newest: function (a, b) { return (b.origin === "new") - (a.origin === "new") || order.indexOf(a.id) - order.indexOf(b.id); }
    };
    return list.sort(sorters[state.sort] || sorters.featured);
  }

  var tile = '<a class="editorial-tile" href="about.html">' +
    '<div class="media"><img src="' + esc(UI.img("photo-02")) + '" alt="A woman in a white VANTÉ tee seated on travertine steps." width="900" height="1200" loading="lazy" decoding="async"></div>' +
    '<div class="editorial-tile__text"><span class="label">The house</span><span class="h3">Made to be you.</span><span class="label" style="text-decoration:underline;text-underline-offset:4px">Our story</span></div></a>';

  function render(animate) {
    var list = results();
    countEl.textContent = list.length + " piece" + (list.length === 1 ? "" : "s");
    if (!list.length) {
      grid.innerHTML = '<div class="empty-state"><p class="h3">Nothing here — yet.</p><p class="muted">No pieces match these filters.</p><button type="button" class="btn btn--ghost" data-reset>Clear filters</button></div>';
      return;
    }
    var html = list.map(function (p, i) {
      var c = state.color || (i % 3 === 1 ? CAT.variant(p, "white").color : p.variants[0].color);
      return UI.card(p, { color: c, className: animate ? "is-entering" : "" });
    });
    if (list.length >= 6 && !state.q) html.splice(5, 0, tile);
    grid.innerHTML = html.join("");
    if (animate) $$(".card", grid).forEach(function (c, i) { c.style.animationDelay = (Math.min(i, 8) * 0.05) + "s"; });
    if (window.ScrollTrigger) window.ScrollTrigger.refresh();
  }

  function pushUrl() {
    var params = new URLSearchParams();
    Object.keys(state).forEach(function (k) { if (state[k] && !(k === "sort" && state[k] === "featured")) params.set(k, state[k]); });
    var qs = params.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
  }
  function update() { syncControls(); heading(); render(true); pushUrl(); }

  chipsEl.addEventListener("click", function (e) {
    var c = e.target.closest("[data-cat]"), col = e.target.closest("[data-colorf]");
    if (c) state.category = c.getAttribute("data-cat");
    else if (col) state.color = state.color === col.getAttribute("data-colorf") ? "" : col.getAttribute("data-colorf");
    else return;
    update();
  });
  collSel.addEventListener("change", function () { state.collection = collSel.value; update(); });
  sortSel.addEventListener("change", function () { state.sort = sortSel.value; update(); });
  grid.addEventListener("click", function (e) {
    if (e.target.closest("[data-reset]")) { state = { category: "", collection: "", color: "", filter: "", sort: "featured", q: "" }; update(); }
  });

  syncControls();
  heading();
  render(false);
  UI.initMotion();
})();
