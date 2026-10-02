/*
 * VANTÉ — policy pages. Shipping rates and destination lists are rendered from
 * config.js so the policy can never disagree with what checkout charges.
 */
(function () {
  "use strict";
  var V = window.VANTE, CFG = V.config, UI = window.VANTE_UI, esc = UI.esc;
  UI.$$("[data-shipping-table]").forEach(function (n) {
    var rows = [];
    CFG.shipping.forEach(function (z) {
      z.methods.forEach(function (m, i) {
        rows.push("<tr>" + (i === 0 ? '<td rowspan="' + z.methods.length + '"><strong>' + esc(z.name) + "</strong><br><span class=\"muted\">" + esc(Object.keys(z.countries).map(function (c) { return z.countries[c]; }).join(", ")) + "</span></td>" : "") +
          "<td>" + esc(m.name) + "</td><td>" + esc(m.eta) + "</td><td>" + esc(V.money(m.price)) + (m.freeEligible ? "<br><span class=\"muted\">Free over " + esc(V.money(CFG.freeShippingOver)) + "</span>" : "") + "</td></tr>");
      });
    });
    n.innerHTML = '<table><thead><tr><th>Destination</th><th>Method</th><th>Delivery after production</th><th>Price (' + esc(CFG.currency) + ")</th></tr></thead><tbody>" + rows.join("") + "</tbody></table>";
  });
  UI.$$("[data-duties-list]").forEach(function (n) {
    n.innerHTML = CFG.shipping.map(function (z) { return "<li><strong>" + esc(z.name) + ".</strong> " + esc(z.duties) + "</li>"; }).join("");
  });
  UI.$$("[data-country-list]").forEach(function (n) {
    n.textContent = V.shipping.countries().map(function (c) { return c.name; }).join(", ");
  });
})();
