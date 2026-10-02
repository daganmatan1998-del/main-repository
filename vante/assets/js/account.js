/* VANTÉ — account page: saved pieces (kept on this device). */
(function () {
  "use strict";
  var V = window.VANTE, CAT = V.catalog, UI = window.VANTE_UI, $ = UI.$;
  var box = $("[data-saved]"), count = $("[data-saved-count]");
  function render() {
    var ids = V.wish.list();
    count.textContent = ids.length + " piece" + (ids.length === 1 ? "" : "s");
    box.innerHTML = ids.length ? ids.map(function (id) {
      return UI.card(CAT.product(id)).replace('<div class="card__info">', '<div class="card__info"><button type="button" class="line-item__remove" style="grid-column:1/-1;justify-self:start;margin:0" data-unsave="' + id + '">Remove</button>');
    }).join("") : '<div class="empty-state" style="grid-column:1/-1"><p class="h3">Nothing saved yet.</p><p class="muted">Use “Save for later” on any piece to keep it here.</p><a class="btn btn--ghost" href="shop.html">Browse the collection</a></div>';
  }
  box.addEventListener("click", function (e) {
    var b = e.target.closest("[data-unsave]");
    if (b) { V.wish.toggle(b.getAttribute("data-unsave")); }
  });
  window.addEventListener("vante:wish", render);
  render();
  UI.initMotion();
})();
