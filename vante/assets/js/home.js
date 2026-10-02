/*
 * VANTÉ — home page scenes.
 * Each scene degrades to a static, fully usable layout when motion is reduced
 * or GSAP is unavailable (the CSS handles .no-motion).
 */
(function () {
  "use strict";
  var V = window.VANTE, CAT = V.catalog, UI = window.VANTE_UI;
  var $ = UI.$, $$ = UI.$$;
  var g = window.gsap, ST = window.ScrollTrigger;
  var motion = UI.hasGSAP;

  /* ---------- Render product blocks ---------- */
  var newGrid = $('[data-products="new"]');
  newGrid.innerHTML = CAT.PRODUCTS.filter(function (p) { return p.origin === "new"; }).slice(0, 4)
    .map(function (p, i) { return UI.card(p, { color: i % 2 ? "white" : "black", className: "fade-up" }); }).join("");
  $$(".card", newGrid).forEach(function (c, i) { c.setAttribute("data-delay", (i % 4) * 0.08); });

  var featured = $("[data-featured]");
  var feat = ["pegasus-tee", "icarus-tee", "celestial-tee", "summit-tee"].map(CAT.product).filter(Boolean);
  featured.insertAdjacentHTML("beforeend", feat.map(function (p, i) {
    return UI.card(p, { color: i === 0 || i === 3 ? "black" : "white", className: "f" + (i + 1) + " fade-up" });
  }).join(""));

  /* ---------- Product reveal ---------- */
  (function () {
    var sec = $("[data-reveal-product]");
    var p = CAT.product(sec.getAttribute("data-reveal-product"));
    var image = $("[data-reveal-img]", sec);
    var v = p.variants[0];
    image.src = UI.img(v.images[0]);
    image.alt = p.name + " in " + CAT.COLORS[v.color].name.toLowerCase() + ", back print";
    $("[data-reveal-kicker]", sec).textContent = CAT.COLLECTIONS[p.collections[0]].name + " · " + (p.badge || "");
    $("[data-reveal-name]", sec).textContent = p.name;
    $("[data-reveal-line]", sec).textContent = p.line;
    $("[data-reveal-price]", sec).textContent = V.money(p.price);
    var link = $("[data-reveal-link]", sec);
    link.href = UI.productUrl(p, v.color);
    UI.picker($("[data-reveal-picker]", sec), p, {
      color: v.color, dark: false, flyFrom: function () { return image; },
      onColor: function (c) {
        UI.swapImage(image, UI.img(CAT.variant(p, c).images[0]), p.name + " in " + CAT.COLORS[c].name.toLowerCase() + ", back print");
        link.href = UI.productUrl(p, c);
      }
    });
  })();

  /* ---------- Limited drop ---------- */
  (function () {
    var sec = $("[data-drop]");
    var p = CAT.product(sec.getAttribute("data-drop"));
    var image = $("[data-drop-img]", sec);
    image.src = UI.img(p.variants[0].images[0]);
    image.alt = p.name + " in black";
    UI.picker($("[data-drop-picker]", sec), p, {
      dark: true, flyFrom: function () { return image; },
      onColor: function (c) { UI.swapImage(image, UI.img(CAT.variant(p, c).images[0]), p.name + " in " + CAT.COLORS[c].name.toLowerCase()); }
    });
  })();

  /* ---------- Words of the statement (static fallback is full opacity) ---------- */
  var words = UI.splitWords($("[data-words]"));

  if (!motion) { UI.initMotion(); return; }

  /* ---------- Hero ---------- */
  var heroImg = $(".hero__media img");
  var chars = $$(".hero__title .char");
  g.set(chars, { yPercent: 105 });
  g.set(".hero__row > *", { opacity: 0, y: 20 });
  UI.runLoader(function () {
    g.timeline()
      .to(heroImg, { scale: 1, duration: 2.4, ease: "expo.out" }, 0)
      .to(chars, { yPercent: 0, duration: 1.5, ease: "power4.out", stagger: 0.07 }, 0.1)
      .to(".hero__row > *", { opacity: 1, y: 0, duration: 1.2, ease: "power3.out", stagger: 0.1 }, 0.6);
  });
  $(".hero__title").style.overflow = "hidden";
  g.to(heroImg, { yPercent: 16, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });
  // The letters drift apart at different speeds as the page lifts away.
  chars.forEach(function (c, i) {
    g.to(c, { y: function () { return -window.innerHeight * (0.12 + Math.abs(2 - i) * 0.06); }, ease: "none",
      scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });
  });
  g.to(".hero__shade", { opacity: 1.6, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });

  /* ---------- Statement: words light up as you read ---------- */
  g.to(words, {
    opacity: 1, stagger: 0.1, ease: "none",
    scrollTrigger: { trigger: "[data-words]", start: "top 78%", end: "bottom 45%", scrub: true }
  });

  /* ---------- Cinema: the frame opens to full bleed ---------- */
  var cinema = $("[data-cinema]");
  g.timeline({ scrollTrigger: { trigger: cinema, start: "top top", end: "+=160%", pin: true, scrub: 0.6, anticipatePin: 1 } })
    .fromTo($(".cinema__frame", cinema), { clipPath: "inset(22% 31% 22% 31%)" }, { clipPath: "inset(0% 0% 0% 0%)", ease: "power2.inOut", duration: 1 }, 0)
    .to($(".cinema__frame img", cinema), { scale: 1, ease: "power2.inOut", duration: 1 }, 0)
    .fromTo($(".cinema__caption .h1", cinema), { scale: 0.72 }, { scale: 1.08, ease: "none", duration: 1.3 }, 0)
    .to($$(".cinema__corner", cinema), { opacity: 0, duration: 0.3 }, 0.55)
    .to($(".cinema__caption", cinema), { opacity: 0, duration: 0.3 }, 1.05);

  /* ---------- Reveal: model → zoom → interactive product ---------- */
  var rev = $("[data-reveal-product]");
  var mm = g.matchMedia();
  mm.add({ desktop: "(min-width: 961px)", mobile: "(max-width: 960px)" }, function (ctx) {
    var tl = g.timeline({ scrollTrigger: { trigger: rev, start: "top top", end: ctx.conditions.desktop ? "+=220%" : "+=170%", pin: true, scrub: 0.7, anticipatePin: 1 } });
    tl.to($(".reveal__photo img", rev), { scale: 2.1, yPercent: 8, ease: "power1.in", duration: 1 }, 0)
      .to($(".reveal__intro", rev), { opacity: 0, y: -30, duration: 0.3 }, 0.05)
      .to($(".reveal__photo", rev), { opacity: 0, duration: 0.35 }, 0.62)
      .to($(".reveal__stage", rev), { opacity: 1, duration: 0.3 }, 0.62)
      .from($(".reveal__product img", rev), { scale: 0.82, yPercent: 8, duration: 0.5, ease: "power2.out" }, 0.62)
      .from($$(".reveal__panel > *", rev), { opacity: 0, y: 26, stagger: 0.05, duration: 0.35 }, 0.72)
      .to({}, { duration: 0.35 });
    return function () { g.set($$(".reveal__panel > *", rev), { clearProps: "all" }); };
  });

  /* ---------- Lookbook: vertical scroll drives horizontal travel ---------- */
  var look = $("[data-lookbook]"), track = $("[data-track]", look);
  function distance() { return Math.max(0, track.scrollWidth - window.innerWidth); }
  g.to(track, {
    x: function () { return -distance(); }, ease: "none",
    scrollTrigger: { trigger: look, start: "top top", end: function () { return "+=" + distance(); }, pin: true, scrub: 0.8, invalidateOnRefresh: true, anticipatePin: 1,
      onUpdate: function (self) { g.set("[data-progress]", { scaleX: self.progress }); } }
  });
  $$(".look .media img", look).forEach(function (im) { g.set(im, { scale: 1.12 }); });

  /* ---------- Everything else ---------- */
  UI.initMotion();
  window.addEventListener("load", function () { ST.refresh(); });
})();
