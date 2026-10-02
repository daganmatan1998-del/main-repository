/*
 * VANTÉ — collections index. One row per collection with its pieces; on
 * desktop an editorial photograph follows the pointer over each row.
 */
(function () {
  "use strict";
  var CAT = window.VANTE.catalog, UI = window.VANTE_UI;
  var $ = UI.$, $$ = UI.$$, esc = UI.esc;
  var PHOTO = { "marble-and-ink": "photo-08", celestial: "photo-12", essentials: "photo-02", "drop-002": "photo-03" };

  var list = $("[data-coll-list]");
  list.innerHTML = Object.keys(CAT.COLLECTIONS).map(function (k) {
    var c = CAT.COLLECTIONS[k];
    var items = CAT.PRODUCTS.filter(function (p) { return p.collections.indexOf(k) !== -1; });
    return '<a class="coll-row fade-up" href="shop.html?collection=' + k + '" data-photo="' + esc(UI.img(PHOTO[k])) + '">' +
      '<span style="display:grid;gap:6px"><span class="label muted">' + esc(c.kicker) + '</span><span class="label">' + items.length + " pieces</span></span>" +
      '<span style="display:grid;gap:10px"><span class="coll-row__name">' + esc(c.name) + '</span><span class="muted" style="max-width:52ch">' + esc(c.description) + "</span></span>" +
      '<span class="coll-row__thumbs" aria-hidden="true">' + items.slice(0, 3).map(function (p) {
        return '<span><img src="' + esc(UI.img(p.variants[0].images[0])) + '" alt="" width="72" height="90" loading="lazy"></span>';
      }).join("") + "</span></a>";
  }).join("");

  var peek = $("[data-peek]"), peekImg = $("img", peek);
  if (!UI.reduced && window.matchMedia("(hover: hover)").matches) {
    var x = 0, y = 0, tx = 0, ty = 0, raf = null;
    function loop() { x += (tx - x) * 0.14; y += (ty - y) * 0.14; peek.style.left = x + "px"; peek.style.top = y + "px"; raf = requestAnimationFrame(loop); }
    $$(".coll-row", list).forEach(function (row) {
      row.addEventListener("mouseenter", function () { peekImg.src = row.getAttribute("data-photo"); peek.classList.add("is-on"); if (!raf) loop(); });
      row.addEventListener("mouseleave", function () { peek.classList.remove("is-on"); });
    });
    document.addEventListener("mousemove", function (e) { tx = e.clientX + 30; ty = e.clientY - 200; });
  }
  UI.initMotion();
})();
