/* =====================================================================
   CONFIG / CONTENT TO SUPPLY
   Everything below is empty on purpose: only what is visible in the
   product photograph is shown on the site. Fill these in and the page
   picks them up; leave them empty and each part degrades gracefully.
   ===================================================================== */
var CONFIG = {
  businessName: "",          // legal / trading name, used in the legal pages
  address: "",               // postal address, legal pages
  email: "",                 // enquiries; used for the mailto fallback
  whatsapp: "",              // digits only with country code, e.g. "447700900123"
  instagram: "",             // handle without @
  formEndpoint: "",          // https URL that accepts a JSON POST (Formspree, Netlify, etc.)
  extraSpecs: [              // e.g. { k: "Case diameter", v: "40 mm" }
  ],
  siteUrl: ""                // canonical https URL, for OG tags and JSON-LD
};

(function () {
  "use strict";
  var doc = document, root = doc.documentElement;
  var hasGsap = typeof window.gsap !== "undefined" && typeof window.ScrollTrigger !== "undefined";
  var mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  function calm() { return mq.matches || root.classList.contains("no-motion"); }
  function $(s, c) { return (c || doc).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); }

  /* ---------- menu ---------- */
  var menuBtn = $(".menu-btn");
  if (menuBtn) {
    menuBtn.addEventListener("click", function () {
      var open = root.classList.toggle("nav-open");
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
      menuBtn.textContent = open ? "Close" : "Menu";
    });
    $$(".nav a").forEach(function (a) {
      a.addEventListener("click", function () {
        root.classList.remove("nav-open");
        menuBtn.setAttribute("aria-expanded", "false");
        menuBtn.textContent = "Menu";
      });
    });
  }

  /* ---------- footer: stop animations (WCAG 2.2.2) ---------- */
  var stop = $(".stop-btn");
  function paintStop() {
    if (!stop) return;
    var off = root.classList.contains("no-motion");
    stop.setAttribute("aria-pressed", off ? "true" : "false");
    stop.textContent = off ? "Animations stopped" : "Stop animations";
  }
  if (stop) {
    paintStop();
    stop.addEventListener("click", function () {
      var off = root.classList.toggle("no-motion");
      try { localStorage.setItem("achengy-no-motion", off ? "1" : "0"); } catch (e) {}
      paintStop();
      if (off) window.location.reload();
    });
  }

  /* ---------- config-driven bits (work with or without GSAP) ---------- */
  $$("[data-cfg]").forEach(function (el) {
    var v = CONFIG[el.getAttribute("data-cfg")];
    if (v) el.textContent = v;
  });
  var yr = $("#year"); if (yr) yr.textContent = new Date().getFullYear();

  var specsDl = $("#specList");
  if (specsDl && CONFIG.extraSpecs.length) {
    CONFIG.extraSpecs.forEach(function (s) {
      var row = doc.createElement("div"); row.className = "row";
      var dt = doc.createElement("dt"); dt.textContent = s.k;
      var dd = doc.createElement("dd"); dd.textContent = s.v;
      row.appendChild(dt); row.appendChild(dd); specsDl.appendChild(row);
    });
    var tbc = $("#specTbc"); if (tbc) tbc.hidden = true;
  }

  /* ---------- live dial ---------- */
  var dial = $("#liveDial");
  if (dial) {
    var hH = $("#hHand"), mH = $("#mHand"), sH = $("#sHand"), dT = $("#dateTxt");
    var tick = function () {
      var n = new Date();
      var s = n.getSeconds() + n.getMilliseconds() / 1000;
      var m = n.getMinutes() + s / 60;
      var h = (n.getHours() % 12) + m / 60;
      hH.setAttribute("transform", "rotate(" + (h * 30) + " 250 250)");
      mH.setAttribute("transform", "rotate(" + (m * 6) + " 250 250)");
      sH.setAttribute("transform", "rotate(" + (Math.floor(s) * 6) + " 170 330)");
      dT.textContent = n.getDate();
    };
    tick(); setInterval(tick, 1000);
  }

  /* ---------- enquiry form ---------- */
  var form = $("#enqForm");
  if (form) {
    var note = $("#formNote");
    if (!CONFIG.formEndpoint && !CONFIG.whatsapp && !CONFIG.email && !CONFIG.instagram) {
      note.textContent = "Enquiries open soon: contact details have not been added to this site yet.";
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (form.elements.company.value) return; /* honeypot */
      var name = form.elements.name.value.trim(), mail = form.elements.email.value.trim(), msg = form.elements.message.value.trim();
      var text = "ACHENGY enquiry from " + name + " (" + mail + "): " + msg;
      note.className = "form-note";
      if (CONFIG.formEndpoint) {
        fetch(CONFIG.formEndpoint, { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify({ name: name, email: mail, message: msg }) })
          .then(function (r) { if (!r.ok) throw 0; note.textContent = "Thank you, your message was sent."; note.className = "form-note ok"; form.reset(); })
          .catch(function () { note.textContent = "Sorry, that did not send. Please try again later."; });
      } else if (CONFIG.whatsapp) {
        window.open("https://wa.me/" + CONFIG.whatsapp + "?text=" + encodeURIComponent(text), "_blank", "noopener");
        note.textContent = "Opening WhatsApp with your message ready."; note.className = "form-note ok";
      } else if (CONFIG.email) {
        window.location.href = "mailto:" + CONFIG.email + "?subject=" + encodeURIComponent("ACHENGY enquiry") + "&body=" + encodeURIComponent(text);
      } else if (CONFIG.instagram) {
        window.open("https://ig.me/m/" + CONFIG.instagram, "_blank", "noopener");
        note.textContent = "Opening Instagram messages."; note.className = "form-note ok";
      } else {
        note.textContent = "Enquiries open soon: contact details have not been added to this site yet.";
      }
    });
  }

  /* ---------- motion ---------- */
  var loader = $(".loader"), wipe = $(".wipe");
  try { sessionStorage.setItem("achengy-seen", "1"); } catch (e) {}

  if (!hasGsap || calm()) {
    if (loader) loader.classList.remove("on");
    if (wipe) wipe.style.display = "none";
    return;
  }
  var gsap = window.gsap, ST = window.ScrollTrigger;
  gsap.registerPlugin(ST);
  var EASE = "power4.out";

  /* page-to-page wipe: left to right in, continues out on the next page */
  var coming = false;
  try { coming = sessionStorage.getItem("achengy-wipe") === "1"; sessionStorage.removeItem("achengy-wipe"); } catch (e) {}
  if (wipe) {
    if (coming) {
      gsap.set(wipe, { clipPath: "inset(0% 0% 0% 0%)" });
      gsap.to(wipe, { clipPath: "inset(0% 0% 0% 100%)", duration: .7, ease: "power3.inOut", delay: .05 });
    }
    $$("a[href]").forEach(function (a) {
      var href = a.getAttribute("href");
      if (!href || href.charAt(0) === "#" || /^(mailto:|tel:|https?:)/.test(href) || a.target === "_blank") return;
      a.addEventListener("click", function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
        e.preventDefault();
        try { sessionStorage.setItem("achengy-wipe", "1"); } catch (er) {}
        gsap.to(wipe, { clipPath: "inset(0% 0% 0% 0%)", duration: .55, ease: "power3.inOut", onComplete: function () { window.location.href = href; } });
      });
    });
  }

  /* cursor: a lume dot with a minute ring */
  if (window.matchMedia("(hover:hover) and (pointer:fine)").matches) {
    var cur = $(".cursor");
    if (cur) {
      root.classList.add("has-cursor");
      var xTo = gsap.quickTo(cur, "x", { duration: .25, ease: "power3" }), yTo = gsap.quickTo(cur, "y", { duration: .25, ease: "power3" });
      window.addEventListener("mousemove", function (e) { xTo(e.clientX); yTo(e.clientY); });
      $$("a,button,.btn").forEach(function (el) {
        el.addEventListener("mouseenter", function () { cur.classList.add("big"); });
        el.addEventListener("mouseleave", function () { cur.classList.remove("big"); });
      });
      /* magnetic buttons */
      $$(".btn").forEach(function (b) {
        b.addEventListener("mousemove", function (e) {
          var r = b.getBoundingClientRect();
          gsap.to(b, { x: (e.clientX - r.left - r.width / 2) * .25, y: (e.clientY - r.top - r.height / 2) * .35, duration: .3 });
        });
        b.addEventListener("mouseleave", function () { gsap.to(b, { x: 0, y: 0, duration: .5, ease: "elastic.out(1,.5)" }); });
      });
    }
  }

  function intro() {
    var tl = gsap.timeline({ defaults: { ease: EASE } });
    tl.from(".hero-words .w", { yPercent: 60, opacity: 0, duration: 1.2, stagger: .12 })
      .from(".hero-media", { opacity: 0, scale: 1.08, duration: 1.6 }, 0)
      .from(".hero-top,.hero-sub,.hero-actions", { y: 24, opacity: 0, duration: 1, stagger: .1 }, .5)
      .from(".site-header", { y: -30, opacity: 0, duration: .9 }, .3);
  }

  if (loader && root.classList.contains("first-visit")) {
    loader.classList.add("on");
    gsap.to(loader, { opacity: 0, duration: .6, delay: 1.2, ease: "power2.out", onComplete: function () { loader.classList.remove("on"); intro(); } });
  } else if ($(".hero")) { intro(); }

  /* hero: pinned; the words drift apart while the camera pushes into the dial */
  if ($(".hero")) {
    var hero = gsap.timeline({ scrollTrigger: { trigger: ".hero", start: "top top", end: "+=110%", scrub: .6, pin: true, anticipatePin: 1 } });
    hero.to(".hero-media", { scale: 2.3, ease: "none" }, 0)
        .to(".hero-words .w:nth-child(1)", { xPercent: -14, ease: "none" }, 0)
        .to(".hero-words .w:nth-child(2)", { xPercent: 10, ease: "none" }, 0)
        .to(".hero-words .w:nth-child(3)", { xPercent: -8, ease: "none" }, 0)
        .to(".hero-top,.hero-sub,.hero-actions,.scroll-cue", { opacity: 0, y: -30, ease: "none" }, 0)
        .to(".hero-words", { opacity: .0, ease: "none" }, .55);
  }

  /* statement: words light up with scroll */
  var st = $(".statement p[data-words]");
  if (st) {
    var out = [];
    st.childNodes.forEach(function (node) {
      if (node.nodeType === 3) {
        node.textContent.split(/(\s+)/).forEach(function (w) {
          if (!w) return;
          if (/^\s+$/.test(w)) { out.push(doc.createTextNode(" ")); return; }
          var s = doc.createElement("span"); s.className = "wd"; s.textContent = w; out.push(s);
        });
      } else {
        node.classList.add("wd"); out.push(node);
      }
    });
    st.textContent = ""; out.forEach(function (n) { st.appendChild(n); });
    gsap.fromTo($$(".wd", st), { opacity: .14 }, { opacity: 1, stagger: .08, ease: "none", scrollTrigger: { trigger: st, start: "top 80%", end: "bottom 45%", scrub: true } });
  }

  /* panels: pinned horizontal track on wide screens */
  var mm = gsap.matchMedia();
  mm.add("(min-width: 900px)", function () {
    var track = $(".track"), pin = $(".pin");
    if (!track || !pin) return;
    var dist = function () { return Math.max(0, track.scrollWidth - window.innerWidth + 48); };
    gsap.to(track, { x: function () { return -dist(); }, ease: "none", scrollTrigger: { trigger: pin, start: "top top", end: function () { return "+=" + dist(); }, pin: true, scrub: .6, invalidateOnRefresh: true, anticipatePin: 1 } });
    gsap.from(".panel .num", { scale: 1.6, opacity: 0, ease: "expo.out", duration: 1.2, stagger: .2, scrollTrigger: { trigger: pin, start: "top 70%" } });
  });
  mm.add("(max-width: 899px)", function () {
    gsap.from(".panel", { y: 60, opacity: 0, stagger: .15, ease: "power3.out", scrollTrigger: { trigger: ".track", start: "top 85%" } });
  });

  /* headings and blocks */
  $$(".h2").forEach(function (h) {
    gsap.from(h, { yPercent: 40, opacity: 0, ease: EASE, duration: 1.1, scrollTrigger: { trigger: h, start: "top 88%" } });
  });
  gsap.from(".dial-wrap", { scale: .86, opacity: 0, rotate: -6, ease: "back.out(1.4)", duration: 1.2, scrollTrigger: { trigger: ".dial-wrap", start: "top 80%" } });
  gsap.from(".specs .row", { y: 40, opacity: 0, stagger: .1, ease: "power3.out", duration: .8, scrollTrigger: { trigger: ".specs dl", start: "top 80%" } });
  gsap.from(".enquire form > *", { y: 30, opacity: 0, stagger: .08, ease: "power3.out", scrollTrigger: { trigger: ".enquire form", start: "top 85%" } });

  window.addEventListener("load", function () { ST.refresh(); });
})();
