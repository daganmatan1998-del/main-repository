(function(){
"use strict";

/* ================= CONTENT TO SUPPLY =================
   Only verified facts are on the site. Fill these in from the bar's real
   information and every page picks them up; nothing else needs to change. */
var CONFIG = {
  instagram: "ha.hetzi.ha.sheni",
  // A URL that accepts a JSON POST of the reservation (Formspree, a Worker, a booking system).
  // While empty, the form prepares the request for sending as an Instagram message.
  reservationEndpoint: ""
};
// Opening hours, Sunday first. Example: ["18:00–01:00", "סגור", ...]. Empty = "updates on Instagram".
var HOURS = [];
// Café menu items: { name, desc, price } — price in shekels, or omit it.
// (The bar menu is written straight into menu.html, copied from menu-alcohol.jpg.)
var MENU = { cafe: [] };
// Photos: { src, srcMobile, alt }. The gallery on the home page appears once this has entries.
var PHOTOS = [];

var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
var fine = window.matchMedia("(hover:hover) and (pointer:fine)").matches;
var hasGsap = typeof window.gsap !== "undefined" && typeof window.ScrollTrigger !== "undefined";
var $ = function(s, r){ return (r || document).querySelector(s); };
var $$ = function(s, r){ return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }

/* ---------- café menu ---------- */
$$("[data-menu]").forEach(function(ul){
  var items = MENU[ul.getAttribute("data-menu")] || [];
  if (!items.length){
    ul.outerHTML = '<div class="menu-note"><strong>התפריט בדרך לכאן</strong>בינתיים הוא מחכה על הבר, ועדכונים עולים ל<a class="link-u" href="https://www.instagram.com/' + CONFIG.instagram + '/" target="_blank" rel="noopener">אינסטגרם</a>.</div>';
    return;
  }
  ul.innerHTML = items.map(function(it){
    return '<li class="menu-item"><h4 style="margin:0;font-weight:700;font-size:1.15rem">' + esc(it.name) + '</h4>' +
      (it.price != null ? '<span class="price" data-price="' + Number(it.price) + '">₪' + Number(it.price) + '</span>' : '') +
      (it.desc ? '<p>' + esc(it.desc) + '</p>' : '') + '</li>';
  }).join("");
});

/* ---------- hours ---------- */
if (HOURS.length === 7 && $("#hoursBox")){
  var days = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"], today = new Date().getDay();
  $("#hoursBox").innerHTML = '<table class="hours"><tbody>' + HOURS.map(function(h, i){
    return '<tr' + (i === today ? ' class="today"' : '') + '><td>' + days[i] + '</td><td>' + esc(h) + '</td></tr>';
  }).join("") + '</tbody></table>';
}

/* ---------- gallery ---------- */
if (PHOTOS.length && $("#gallery")){
  $("#gGrid").innerHTML = PHOTOS.map(function(p){
    return '<figure><picture>' + (p.srcMobile ? '<source media="(max-width:700px)" srcset="' + esc(p.srcMobile) + '">' : '') +
      '<img src="' + esc(p.src) + '" alt="' + esc(p.alt || "") + '" loading="lazy" decoding="async"></picture></figure>';
  }).join("");
  $("#gallery").hidden = false;
}

/* ---------- nav ---------- */
var burger = $(".burger");
function setMenu(open){
  document.body.classList.toggle("nav-open", open);
  burger.setAttribute("aria-expanded", open ? "true" : "false");
  burger.setAttribute("aria-label", open ? "סגירת תפריט" : "פתיחת תפריט");
  document.body.style.overflow = open ? "hidden" : "";
}
if (burger){
  burger.addEventListener("click", function(){ setMenu(!document.body.classList.contains("nav-open")); });
  $$("#mobileMenu a").forEach(function(a){ a.addEventListener("click", function(){ setMenu(false); }); });
  document.addEventListener("keydown", function(e){ if (e.key === "Escape") setMenu(false); });
}

/* ---------- every page and every link starts at the top of what it opens ---------- */
// The browser would otherwise restore an old scroll position, and when the site sits inside a
// frame (the artifact viewer) the outer page keeps its own scroll. scrollIntoView moves both.
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
function goTo(el, smooth){
  if (!el) return;
  el.scrollIntoView({block: "start", behavior: smooth && !reduce ? "smooth" : "auto"});
}
if (!location.hash || !document.getElementById(location.hash.slice(1))){
  scrollTo(0, 0);
  goTo(document.body);
}
document.addEventListener("click", function(e){
  var a = e.target.closest && e.target.closest("a[href]");
  if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  var url; try { url = new URL(a.getAttribute("href"), location.href); } catch (err) { return; }
  if (url.origin !== location.origin || !url.hash || !samePage(url)) return;
  var target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
  if (!target) return;
  e.preventDefault();
  goTo(target, true);
  if (history.replaceState) history.replaceState(null, "", url.hash);
});

/* ---------- page transitions: a night-coloured wipe between pages ---------- */
function samePage(url){ // hoisted; also used by the link handler above
 return url.pathname.replace(/index\.html$/, "") === location.pathname.replace(/index\.html$/, ""); }
if (!reduce){
  var wipe = document.createElement("div");
  wipe.className = "wipe"; wipe.setAttribute("aria-hidden", "true");
  document.body.appendChild(wipe);
  var cameIn = false; try { cameIn = sessionStorage.getItem("hh-wipe") === "1"; sessionStorage.removeItem("hh-wipe"); } catch (err) {}
  if (cameIn){
    wipe.classList.add("cover");
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ wipe.classList.remove("cover"); wipe.classList.add("out"); }); });
  }
  document.addEventListener("click", function(e){
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || a.target === "_blank" || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    var url; try { url = new URL(a.getAttribute("href"), location.href); } catch (err) { return; }
    if (url.origin !== location.origin || !/\.html$/.test(url.pathname) || samePage(url)) return;
    e.preventDefault();
    try { sessionStorage.setItem("hh-wipe", "1"); } catch (err) {}
    wipe.classList.remove("out"); wipe.classList.add("in");
    setTimeout(function(){ location.href = url.href; }, 520);
  });
  // Coming back through the browser's history restores a frozen page with the wipe still drawn.
  addEventListener("pageshow", function(e){ if (e.persisted){ wipe.classList.remove("in", "cover"); } });
}

/* ---------- menu tabs ---------- */
function showHalf(which, animate){
  $$(".menu-tabs [role=tab]").forEach(function(t){
    var on = t.id === "tab-" + which;
    t.setAttribute("aria-selected", on ? "true" : "false"); t.tabIndex = on ? 0 : -1;
  });
  $("#half-cafe").setAttribute("data-hidden", which !== "cafe");
  $("#half-bar").setAttribute("data-hidden", which !== "bar");
  if (animate && hasGsap && !reduce){
    gsap.fromTo("#half-" + which + " .h-menu, #half-" + which + " .lede, #half-" + which + " table, #half-" + which + " .menu-note",
      {y: 24, opacity: 0}, {y: 0, opacity: 1, stagger: .03, duration: .5, ease: "power3.out", clearProps: "all"});
  }
  if (window.ScrollTrigger) ScrollTrigger.refresh();
}
if ($("#menu")){
  $("#menu").classList.add("js-tabs");
  $("#tab-cafe").addEventListener("click", function(){ showHalf("cafe", true); });
  $("#tab-bar").addEventListener("click", function(){ showHalf("bar", true); });
  $(".menu-tabs").addEventListener("keydown", function(e){
    if (e.key === "ArrowLeft" || e.key === "ArrowRight"){
      var next = document.activeElement.id === "tab-cafe" ? "bar" : "cafe";
      showHalf(next, true); $("#tab-" + next).focus();
    }
  });
  showHalf(location.hash === "#cafe" ? "cafe" : "bar");
}

/* ---------- original menu image ---------- */
var dlg = $("#menuDialog");
if (dlg){
  $("#openMenuImg").addEventListener("click", function(){
    if (dlg.showModal) dlg.showModal(); else window.open("menu-alcohol.jpg", "_blank");
  });
  dlg.addEventListener("click", function(e){ if (e.target === dlg) dlg.close(); });
}

/* ---------- reviews: filter by what the review talks about ---------- */
var chips = $$(".rv-chip");
if (chips.length){
  var cards = $$(".rv-card"), status = $("#rvStatus");
  chips.forEach(function(chip){
    chip.addEventListener("click", function(){
      var tag = chip.getAttribute("data-tag"), n = 0;
      chips.forEach(function(c){ c.setAttribute("aria-pressed", c === chip ? "true" : "false"); });
      cards.forEach(function(card){
        var hit = !tag || (" " + card.getAttribute("data-tags") + " ").indexOf(" " + tag + " ") > -1;
        card.classList.toggle("dim", !hit); if (hit) n++;
        $$("mark", card).forEach(function(m){ m.classList.toggle("on", !!tag && m.getAttribute("data-t") === tag); });
      });
      status.textContent = tag ? (n === 1 ? "ביקורת אחת מזכירה " : n + " ביקורות מזכירות ") + chip.getAttribute("data-label") : "כל הביקורות";
    });
  });
}

/* ---------- reservation ---------- */
var form = $("#resForm");
if (form){
  var result = $("#resResult"), gOut = $("#r-guests-out"), gIn = $("#r-guests");
  var t = new Date(); t.setMinutes(t.getMinutes() - t.getTimezoneOffset());
  $("#r-date").min = t.toISOString().slice(0, 10);
  $$(".guests [data-g]").forEach(function(b){
    b.addEventListener("click", function(){
      var n = Math.min(20, Math.max(1, Number(gIn.value) + Number(b.getAttribute("data-g"))));
      gIn.value = n; gOut.textContent = n;
    });
  });
  var fmtDate = function(v){ if (!v) return ""; var p = v.split("-"); return p[2] + "." + p[1] + "." + p[0]; };
  var showManual = function(msg, title){
    result.hidden = false;
    result.innerHTML = "<h3>" + esc(title) + "</h3><pre id=\"resText\">" + esc(msg) + "</pre>" +
      '<div class="row"><button class="btn" type="button" id="copyRes">העתקת ההודעה</button>' +
      '<a class="btn ghost" href="https://ig.me/m/' + CONFIG.instagram + '" target="_blank" rel="noopener">פתיחת הודעה באינסטגרם</a></div>';
    $("#copyRes").addEventListener("click", function(){
      var btn = this;
      function done(){ btn.textContent = "הועתק"; }
      function fallback(){ var r = document.createRange(); r.selectNodeContents($("#resText")); var s = getSelection(); s.removeAllRanges(); s.addRange(r); btn.textContent = "הטקסט מסומן, העתיקו אותו ידנית"; }
      try { navigator.clipboard.writeText(msg).then(done, fallback); } catch (err) { fallback(); }
    });
    if (!reduce && hasGsap) gsap.from(result, {y: 20, opacity: 0, duration: .5, ease: "power3.out"});
    result.scrollIntoView({block: "nearest", behavior: reduce ? "auto" : "smooth"});
  };
  form.addEventListener("submit", function(e){
    e.preventDefault();
    if (!form.checkValidity()){
      var bad = form.querySelector(":invalid"); if (bad) bad.focus();
      if (form.reportValidity) form.reportValidity();
      return;
    }
    var d = Object.fromEntries(new FormData(form).entries());
    var msg = "היי! אשמח לשריין מקום בחצי השני.\n" +
      "תאריך: " + fmtDate(d.date) + "\nשעה: " + d.time + "\nכמה אנשים: " + d.guests + "\nשם: " + d.name + "\nטלפון: " + d.phone +
      (d.email ? "\nאימייל: " + d.email : "") + (d.notes ? "\nבקשות: " + d.notes : "");
    if (CONFIG.reservationEndpoint){
      result.hidden = false;
      result.innerHTML = "<h3>שולחים…</h3>";
      fetch(CONFIG.reservationEndpoint, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(d)})
        .then(function(r){ if (!r.ok) throw new Error(r.status); result.innerHTML = "<h3>הבקשה אצלנו. נחזור אליכם לאישור בטלפון.</h3>"; })
        .catch(function(){ showManual(msg, "משהו השתבש בשליחה. אפשר לשלוח לנו את אותה הודעה באינסטגרם:"); });
      return;
    }
    showManual(msg, "ההודעה מוכנה. העתיקו אותה ושלחו לנו באינסטגרם, והמקום שמור אחרי שנאשר.");
  });
}

/* ---------- floating CTA: after the opening screen, hidden over the booking form ---------- */
var cta = $("#floatCta"), bookEl = $("#book");
if (cta){
  var past = false, bookIn = false, updCta = function(){ cta.classList.toggle("show", past && !bookIn); };
  addEventListener("scroll", function(){ past = scrollY > innerHeight * .6; updCta(); }, {passive: true});
  if (bookEl && "IntersectionObserver" in window)
    new IntersectionObserver(function(en){ bookIn = en[0].isIntersecting; updCta(); }, {threshold: .15}).observe(bookEl);
}

/* ---------- progress ---------- */
var prog = $(".progress");
function updProg(){ var h = document.documentElement.scrollHeight - innerHeight; prog.style.transform = "scaleX(" + (h > 0 ? scrollY / h : 0) + ")"; }
if (prog){ addEventListener("scroll", updProg, {passive: true}); updProg(); }

/* ---------- cursor + magnetic (fine pointers, motion allowed) ---------- */
if (fine && !reduce && $(".cursor")){
  var cur = $(".cursor"), cx = innerWidth / 2, cy = innerHeight / 2, x = cx, y = cy;
  addEventListener("pointermove", function(e){ cx = e.clientX; cy = e.clientY; cur.classList.add("on"); }, {passive: true});
  document.addEventListener("pointerleave", function(){ cur.classList.remove("on"); });
  (function loop(){ x += (cx - x) * .22; y += (cy - y) * .22; cur.style.transform = "translate(" + x + "px," + y + "px)"; requestAnimationFrame(loop); })();
  document.addEventListener("pointerover", function(e){ if (e.target.closest && e.target.closest("a,button,input,textarea,select,[role=tab]")) cur.classList.add("big"); });
  document.addEventListener("pointerout", function(e){ if (e.target.closest && e.target.closest("a,button,input,textarea,select,[role=tab]")) cur.classList.remove("big"); });
  $$(".magnetic").forEach(function(el){
    el.addEventListener("pointermove", function(e){
      var r = el.getBoundingClientRect();
      el.style.transform = "translate(" + ((e.clientX - r.left - r.width / 2) * .25) + "px," + ((e.clientY - r.top - r.height / 2) * .35) + "px)";
    });
    el.addEventListener("pointerleave", function(){ el.style.transform = ""; });
  });
}

/* ================= SCROLL CHOREOGRAPHY ================= */
if (!hasGsap || reduce) return;
gsap.registerPlugin(ScrollTrigger);
var has = function(s){ return !!$(s); };
var mm = gsap.matchMedia();

/* Loader on the home page: the two halves of the emblem close into one circle. Once per visit. */
var seen = false; try { seen = sessionStorage.getItem("hh-seen") === "1"; sessionStorage.setItem("hh-seen", "1"); } catch (err) {}
if (!seen && has(".hero") && !location.hash){
  var ld = document.createElement("div");
  ld.className = "loader"; ld.setAttribute("aria-hidden", "true");
  ld.innerHTML = '<div><div class="lh"><span class="a"></span><span class="b"></span></div><p>החצי השני</p></div>';
  document.body.appendChild(ld);
  gsap.timeline({onComplete: function(){ ld.remove(); }})
    .from(ld.querySelector(".a"), {xPercent: -60, opacity: 0, duration: .55, ease: "power3.out"})
    .from(ld.querySelector(".b"), {xPercent: 60, opacity: 0, duration: .55, ease: "power3.out"}, "<")
    .from(ld.querySelector("p"), {y: 20, opacity: 0, duration: .4}, "-=.2")
    .to(ld, {clipPath: "inset(0 0 100% 0)", duration: .7, ease: "power4.inOut"}, "+=.35")
    .from(".hero-word", {yPercent: 40, opacity: 0, stagger: .05, duration: .9, ease: "power4.out"}, "-=.45");
}

/* HERO — the night half wipes across the day half, words drift apart, emblem turns over. */
if (has(".hero")) mm.add({wide: "(min-width:701px)", narrow: "(max-width:700px)"}, function(ctx){
  var wide = ctx.conditions.wide;
  var tl = gsap.timeline({scrollTrigger: {trigger: ".hero", start: "top top", end: "+=130%", scrub: .6, pin: true, anticipatePin: 1}});
  tl.to(".hero-night", {clipPath: "inset(0% 0% 0% 0%)", ease: "none", duration: 1}, 0)
    .to(".hero-words", {scale: 1.12, ease: "none", duration: 1}, 0)
    .to(".hero-words .w1", wide ? {xPercent: 10} : {yPercent: -10}, 0)
    .to(".hero-words .w2", wide ? {xPercent: -10} : {yPercent: 10}, 0)
    .to(".hero-tag", {opacity: 0, y: -20, duration: .4}, 0)
    .to(".emblem", {rotate: 180, scale: .55, ease: "none", duration: 1}, 0)
    .to(".hero-foot", {opacity: 0, duration: .3}, 0)
    .to(".hero-layer, .emblem", {filter: "blur(6px)", opacity: .0, duration: .35}, .72);
});

/* PAGE HEROES on the inner pages — the same night wipe, played out as the heading scrolls away. */
if (has(".page-hero")){
  gsap.from(".ph-title", {yPercent: 30, opacity: 0, duration: 1, ease: "power4.out", delay: .15});
  gsap.to(".ph-night", {clipPath: "inset(0% 0% 0% 0%)", ease: "none",
    scrollTrigger: {trigger: ".page-hero", start: "top top", end: "bottom 30%", scrub: .5}});
  gsap.to(".ph-title", {yPercent: -18, ease: "none", scrollTrigger: {trigger: ".page-hero", start: "top top", end: "bottom top", scrub: true}});
}

/* INTRO — words light up as you read down. */
var intro = $("[data-words]");
if (intro){
  intro.innerHTML = intro.textContent.trim().split(/\s+/).map(function(w){ return '<span class="w">' + w + '</span>'; }).join(" ");
  gsap.fromTo(".intro-text .w", {opacity: .14}, {opacity: 1, stagger: .1, ease: "none",
    scrollTrigger: {trigger: ".intro-text", start: "top 80%", end: "bottom 45%", scrub: true}});
  gsap.from(".intro-meta p", {y: 30, opacity: 0, stagger: .1, duration: .8, ease: "power3.out", scrollTrigger: {trigger: ".intro-meta", start: "top 88%"}});
}

/* REASONS — pinned horizontal run on wide screens; native swipe on phones. */
if (has("#track")){
  mm.add("(min-width:801px)", function(){
    var track = $("#track");
    // RTL: the row overflows to the left, where scrollWidth does not see it. Measure the panels instead.
    var dist = function(){
      var ps = track.querySelectorAll(".panel"), a = ps[0].getBoundingClientRect(), b = ps[ps.length - 1].getBoundingClientRect();
      var gut = parseFloat(getComputedStyle(track).paddingLeft) || 0;
      return Math.max(0, a.right - b.left + gut * 2 - innerWidth);
    };
    gsap.to(track, {x: function(){ return dist(); }, ease: "none",
      scrollTrigger: {trigger: ".reasons", start: "top top", end: function(){ return "+=" + dist(); }, scrub: .8, pin: true, invalidateOnRefresh: true}});
  });
  /* Panel art and titles reveal as each panel enters view, whichever way the row moves.
     (containerAnimation assumes a left-moving LTR row, so it is not used here.) */
  if ("IntersectionObserver" in window){
    document.documentElement.classList.add("anim");
    var pio = new IntersectionObserver(function(en){ en.forEach(function(e){ if (e.isIntersecting){ e.target.classList.add("in"); pio.unobserve(e.target); } }); }, {threshold: .35});
    $$(".panel").forEach(function(p){ pio.observe(p); });
  }
  gsap.from(".reasons-head h2", {yPercent: 60, opacity: 0, duration: 1, ease: "power4.out", scrollTrigger: {trigger: ".reasons", start: "top 80%"}});
}

/* WEEK */
if (has(".week-grid")){
  gsap.from(".day-card", {y: 60, opacity: 0, stagger: .15, duration: 1, ease: "power3.out", scrollTrigger: {trigger: ".week-grid", start: "top 85%"}});
  gsap.from(".day-card .d", {scale: 1.6, opacity: 0, stagger: .15, duration: 1.1, ease: "expo.out", scrollTrigger: {trigger: ".week-grid", start: "top 85%"}});
}

/* MORE — the three doors to the inner pages slide in one after another. */
if (has(".more")){
  gsap.from(".more-row", {xPercent: 12, opacity: 0, stagger: .12, duration: 1, ease: "power4.out", scrollTrigger: {trigger: ".more", start: "top 80%"}});
}

/* MENU — the bar panel rises out of the page, then its categories follow one by one. */
if (has("#half-bar")){
  gsap.from("#half-bar", {clipPath: "inset(8% 4% 0 4% round 24px)", ease: "none", scrollTrigger: {trigger: "#half-bar", start: "top 95%", end: "top 45%", scrub: true}});
  gsap.from("#half-bar table.drink", {y: 40, opacity: 0, stagger: .05, duration: .8, ease: "power3.out", scrollTrigger: {trigger: "#half-bar .drinks", start: "top 88%"}});
  gsap.from(".menu-orig img", {rotate: 18, y: 60, opacity: 0, duration: 1.1, ease: "back.out(1.6)", scrollTrigger: {trigger: ".bar-top", start: "top 90%"}});
}
$$(".price[data-price]").forEach(function(el){
  var n = Number(el.getAttribute("data-price")), o = {v: 0};
  gsap.to(o, {v: n, duration: 1.2, ease: "power2.out", onUpdate: function(){ el.textContent = "₪" + Math.round(o.v); },
    scrollTrigger: {trigger: el, start: "top 92%"}});
});

/* REVIEWS page — the pull quote writes itself in, the cards follow with their quote marks. */
if (has(".pull")){
  gsap.from(".pull .qm", {rotate: -35, scale: .3, opacity: 0, duration: 1.1, ease: "back.out(2)", scrollTrigger: {trigger: ".pull", start: "top 80%"}});
  gsap.from(".pull blockquote p", {y: 50, opacity: 0, filter: "blur(10px)", duration: 1.2, ease: "power3.out", scrollTrigger: {trigger: ".pull", start: "top 80%"}});
}
$$(".rv-card").forEach(function(card){
  gsap.from(card, {y: 70, opacity: 0, duration: 1, ease: "power3.out", scrollTrigger: {trigger: card, start: "top 92%"}});
  gsap.from(card.querySelector(".qm"), {rotate: -35, scale: .3, duration: 1, ease: "back.out(2)", scrollTrigger: {trigger: card, start: "top 92%"}});
});

/* GALLERY */
if (PHOTOS.length){
  $$(".g-grid figure").forEach(function(f){
    gsap.from(f, {clipPath: "inset(100% 0 0 0)", duration: 1.1, ease: "power4.out", scrollTrigger: {trigger: f, start: "top 90%"}});
    gsap.fromTo(f.querySelector("img"), {scale: 1.25, filter: "blur(10px)"}, {scale: 1, filter: "blur(0px)", ease: "none", scrollTrigger: {trigger: f, start: "top bottom", end: "center center", scrub: true}});
  });
}

/* VISIT — the street sign settles onto the wall. */
if (has(".sign")) gsap.from(".sign", {rotate: -9, y: 120, opacity: 0, ease: "none", scrollTrigger: {trigger: ".visit", start: "top 90%", end: "top 35%", scrub: true}});

/* BOOK, CTA BAND, FOOTER */
if (has(".book")){
  gsap.from(".book h2", {yPercent: 50, opacity: 0, duration: 1, ease: "power4.out", scrollTrigger: {trigger: ".book", start: "top 75%"}});
  gsap.from("form.res .field, form.res .form-foot", {y: 30, opacity: 0, stagger: .05, duration: .7, ease: "power3.out", scrollTrigger: {trigger: "form.res", start: "top 80%"}});
}
if (has(".cta-band")) gsap.from(".cta-band h2", {yPercent: 60, opacity: 0, duration: 1, ease: "power4.out", scrollTrigger: {trigger: ".cta-band", start: "top 80%"}});
if (has("footer.site")) gsap.from(".foot-big span", {yPercent: 100, stagger: .1, duration: 1.2, ease: "expo.out", scrollTrigger: {trigger: "footer.site", start: "top 90%"}});

addEventListener("load", function(){
  ScrollTrigger.refresh();
  // Arriving at index.html#book from another page: the pinned sections change the page's
  // height after the browser has already jumped, so jump again once the layout is final.
  if (location.hash && location.hash.length > 1){
    var target = document.getElementById(location.hash.slice(1));
    if (target) setTimeout(function(){ target.scrollIntoView(); }, 60);
  }
});
})();
