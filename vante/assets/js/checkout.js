/*
 * VANTÉ — checkout. Collects delivery details, prices shipping per zone and
 * hands the order to the payment endpoint (see /worker). The browser total is
 * shown for clarity only; the endpoint re-prices everything server-side.
 */
(function () {
  "use strict";
  var V = window.VANTE, CFG = V.config, UI = window.VANTE_UI;
  var $ = UI.$, $$ = UI.$$, esc = UI.esc;
  var form = $("[data-checkout-form]");
  var PREF_KEY = "vante.country";

  /* Returning from the payment page. */
  var status = UI.param("status");
  if (status === "success") {
    V.cart.clear();
    var wrap = form.parentNode;
    wrap.innerHTML = '<div style="display:grid;gap:24px;padding:40px 0;max-width:560px"><p class="label muted">Order received</p><h1 class="h2">Thank you.</h1>' +
      '<p class="lead">Your payment was successful. A confirmation is on its way to your inbox, and your pieces now go into production (' + esc(CFG.processingDays) + ').</p>' +
      '<p class="muted">Questions? Write to <a class="link-underline" href="mailto:' + esc(CFG.business.email) + '">' + esc(CFG.business.email) + "</a>.</p>" +
      '<a class="btn" href="shop.html" style="width:fit-content">Continue shopping</a></div>';
    $(".checkout__summary").hidden = true;
    return;
  }
  if (status === "cancelled") UI.toast("Payment was cancelled. Your bag is just as you left it.");

  /* ---------- Country & methods ---------- */
  var countrySel = $("#co-country");
  countrySel.innerHTML = V.shipping.countries().map(function (c) { return '<option value="' + c.code + '">' + esc(c.name) + "</option>"; }).join("");
  var saved = null;
  if (V.consent.allowed("preferences")) { try { saved = localStorage.getItem(PREF_KEY); } catch (e) { /* none */ } }
  countrySel.value = saved && V.shipping.zoneFor(saved) ? saved : "US";
  var method = "standard";

  function renderMethods() {
    var zone = V.shipping.zoneFor(countrySel.value);
    var sub = V.cart.subtotal();
    if (!zone.methods.some(function (m) { return m.id === method; })) method = zone.methods[0].id;
    var box = $("[data-methods]");
    $$(".radio-card", box).forEach(function (n) { n.remove(); });
    box.insertAdjacentHTML("beforeend", zone.methods.map(function (m) {
      var q = V.shipping.quote(countrySel.value, m.id, sub);
      return '<label class="radio-card"><input type="radio" name="method" value="' + m.id + '"' + (m.id === method ? " checked" : "") + ">" +
        "<span><strong style=\"font-weight:500\">" + esc(m.name) + '</strong><br><span class="muted" style="font-size:var(--fs-small)">' + esc(m.eta) + " after production</span></span>" +
        "<span>" + (q.price === 0 ? "Complimentary" : esc(V.money(q.price))) + "</span></label>";
    }).join(""));
    $("[data-duties]").innerHTML = '<span class="label" id="duties">Duties &amp; taxes</span><br>' + esc(zone.duties);
    var us = countrySel.value === "US";
    $("#co-region").required = us; $("#co-postal").required = us;
    $("[data-region-opt]").hidden = us; $("[data-postal-opt]").hidden = us;
    $("label[for=co-region]").firstChild.textContent = us ? "State " : "State / region ";
    $("label[for=co-postal]").firstChild.textContent = us ? "ZIP code " : "Postal code ";
  }
  countrySel.addEventListener("change", function () {
    if (V.consent.allowed("preferences")) { try { localStorage.setItem(PREF_KEY, countrySel.value); } catch (e) { /* none */ } }
    renderMethods(); renderSummary();
  });
  form.addEventListener("change", function (e) { if (e.target.name === "method") { method = e.target.value; renderSummary(); } });

  /* ---------- Summary ---------- */
  function renderSummary() {
    var items = V.cart.detailed();
    var empty = !items.length;
    $("[data-checkout-empty]").hidden = !empty;
    form.hidden = empty;
    $(".checkout__summary").hidden = empty;
    if (empty) return;
    $("[data-sum-lines]").innerHTML = items.map(function (l) {
      return '<div class="summary-item"><div class="summary-item__img"><img src="' + esc(l.image) + '" alt="" width="64" height="80"><span class="summary-item__qty" aria-label="Quantity">' + l.qty + "</span></div>" +
        '<div><div class="line-item__name" style="font-size:1.05rem">' + esc(l.name) + '</div><div class="line-item__meta">' + esc(l.colorName) + " · " + esc(l.size) + "</div></div>" +
        '<div class="line-item__price">' + esc(V.money(l.total)) + "</div></div>";
    }).join("");
    var sub = V.cart.subtotal();
    var q = V.shipping.quote(countrySel.value, method, sub);
    var dutyFree = q.zone.id === "us";
    $("[data-sum-totals]").innerHTML =
      '<div class="totals__row"><span>Subtotal</span><span>' + esc(V.money(sub)) + "</span></div>" +
      '<div class="totals__row"><span>Shipping · ' + esc(q.method.name) + "</span><span>" + (q.price === 0 ? "Complimentary" : esc(V.money(q.price))) + "</span></div>" +
      '<div class="totals__row"><span>Duties &amp; import taxes</span><span>' + (dutyFree ? "None" : "Paid on delivery") + "</span></div>" +
      '<div class="totals__row totals__row--grand"><span>Total</span><span>' + esc(CFG.currency) + " " + esc(V.money(sub + q.price)) + "</span></div>" +
      (V.shipping.remainingForFree(sub) > 0 && q.method.freeEligible ? '<p class="muted" style="font-size:12px;margin-top:8px">Add ' + esc(V.money(V.shipping.remainingForFree(sub))) + " for complimentary standard shipping.</p>" : "");
  }

  /* ---------- Validation ---------- */
  function setError(input, msg) {
    var field = input.closest(".field");
    if (!field) return;
    var err = $(".field__error", field);
    field.classList.toggle("is-invalid", !!msg);
    input.setAttribute("aria-invalid", msg ? "true" : "false");
    if (msg) {
      if (!err) { err = document.createElement("p"); err.className = "field__error"; err.id = input.id + "-err"; field.appendChild(err); }
      err.textContent = msg;
      input.setAttribute("aria-describedby", err.id);
    } else if (err) { err.remove(); input.removeAttribute("aria-describedby"); }
  }
  function validate() {
    var first = null;
    $$("input, select", form).forEach(function (i) {
      if (i.type === "checkbox" || i.type === "radio") return;
      var msg = "";
      if (i.required && !i.value.trim()) msg = "Required.";
      else if (i.type === "email" && i.value && !i.checkValidity()) msg = "Please enter a valid email.";
      else if (i.type === "tel" && i.value && !/^[+()\d\s-]{7,}$/.test(i.value)) msg = "Please enter a valid phone number.";
      else if (i.id === "co-postal" && countrySel.value === "US" && i.value && !/^\d{5}(-\d{4})?$/.test(i.value.trim())) msg = "Please enter a 5-digit ZIP code.";
      setError(i, msg);
      if (msg && !first) first = i;
    });
    var terms = $("[data-terms]");
    $("[data-terms-error]").hidden = terms.checked;
    if (!terms.checked && !first) first = terms;
    if (first) { first.focus(); return false; }
    return true;
  }
  form.addEventListener("input", function (e) { if (e.target.closest(".field.is-invalid")) setError(e.target, ""); });

  /* ---------- Submit ---------- */
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!validate()) return;
    var endpoint = CFG.checkout && CFG.checkout.endpoint;
    if (!endpoint) { $("[data-pay-off]").hidden = false; $("[data-pay-off]").scrollIntoView({ block: "center" }); return; }
    var data = new FormData(form);
    var payload = {
      items: V.cart.lines().map(function (l) { return { id: l.id, color: l.color, size: l.size, qty: l.qty }; }),
      country: countrySel.value, method: method, email: data.get("email"), marketing: !!data.get("marketing"),
      address: {
        firstName: data.get("firstName"), lastName: data.get("lastName"), line1: data.get("address1"), line2: data.get("address2"),
        city: data.get("city"), region: data.get("region"), postal: data.get("postal"), phone: data.get("phone")
      },
      returnUrl: location.href.split("?")[0]
    };
    var btn = $("[data-pay]");
    btn.classList.add("is-loading"); btn.disabled = true;
    fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.url) throw new Error(j.error || "Checkout failed"); return j; }); })
      .then(function (j) { location.href = j.url; })
      .catch(function (err) {
        btn.classList.remove("is-loading"); btn.disabled = false;
        UI.toast(err.message && err.message.length < 140 ? err.message : "We could not start payment. Please try again.");
      });
  });

  window.addEventListener("vante:cart", renderSummary);
  renderMethods();
  renderSummary();
})();
