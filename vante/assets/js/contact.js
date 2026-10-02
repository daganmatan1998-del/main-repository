/*
 * VANTÉ — contact form. Posts to config.contact.endpoint when set; otherwise
 * opens the visitor's email client with the message prefilled.
 */
(function () {
  "use strict";
  var CFG = window.VANTE.config, UI = window.VANTE_UI, $ = UI.$, $$ = UI.$$;
  var form = $("[data-contact-form]");
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var bad = $$("[required]", form).filter(function (i) { return !i.value.trim() || !i.checkValidity(); });
    $$(".field", form).forEach(function (f) { f.classList.remove("is-invalid"); });
    if (bad.length) { bad.forEach(function (i) { i.closest(".field").classList.add("is-invalid"); }); bad[0].focus(); UI.toast("Please complete the highlighted fields."); return; }
    var d = new FormData(form), data = {};
    d.forEach(function (v, k) { data[k] = v; });
    var ep = CFG.contact && CFG.contact.endpoint;
    if (ep) {
      fetch(ep, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
        .then(function (r) { if (!r.ok) throw new Error(); form.reset(); UI.toast("Thank you — we will reply within one business day."); })
        .catch(function () { UI.toast("We could not send your message. Please email us directly."); });
      return;
    }
    var body = "Name: " + data.name + "\nEmail: " + data.email + (data.order ? "\nOrder: " + data.order : "") + "\n\n" + data.message;
    location.href = "mailto:" + CFG.business.email + "?subject=" + encodeURIComponent("[" + data.topic + "] VANTÉ enquiry") + "&body=" + encodeURIComponent(body);
  });
})();
