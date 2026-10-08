/* NORRVAL — shared client script (every page). No dependencies. */
(() => {
  'use strict';

  const D = JSON.parse(document.getElementById('store-data').textContent);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(pointer: fine)').matches;

  // ---------- storage (can throw in private mode / blocked storage) ----------
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v ? JSON.parse(v) : d;
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch {}
    },
  };

  const fmt = (n) =>
    new Intl.NumberFormat(D.locale, {
      style: 'currency',
      currency: D.currency,
      minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    }).format(n);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // ---------- toast ----------
  let toastT;
  const toast = (msg) => {
    const t = $('[data-toast]');
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('is-on'), 2600);
  };

  // ---------- cart ----------
  const CATALOG = { [D.product.id]: D.product };
  const Cart = {
    items: store.get('norrval_cart', []).filter((i) => CATALOG[i.id] && i.qty > 0),
    save() {
      store.set('norrval_cart', this.items);
      document.dispatchEvent(new CustomEvent('cart:change'));
    },
    add(id, qty = 1) {
      const line = this.items.find((i) => i.id === id);
      if (line) line.qty = Math.min(10, line.qty + qty);
      else this.items.push({ id, qty: Math.min(10, qty) });
      this.save();
    },
    set(id, qty) {
      const line = this.items.find((i) => i.id === id);
      if (!line) return;
      line.qty = Math.max(0, Math.min(10, qty));
      if (!line.qty) this.items = this.items.filter((i) => i !== line);
      this.save();
    },
    count() {
      return this.items.reduce((n, i) => n + i.qty, 0);
    },
    subtotal() {
      return this.items.reduce((n, i) => n + CATALOG[i.id].price * i.qty, 0);
    },
    discount() {
      const b = D.bundle;
      if (!b || this.count() < b.quantity) return 0;
      return Math.round(this.subtotal() * b.percentOff) / 100;
    },
    total() {
      return this.subtotal() - this.discount();
    },
  };
  window.NorrvalCart = Cart; // used by product.js / checkout.js

  const lineHTML = (i) => {
    const p = CATALOG[i.id];
    return `<div class="line" data-line="${esc(i.id)}">
      <a class="line__img" href="${p.url}">${p.image ? `<img src="${p.image}" alt="" width="84" height="84" loading="lazy">` : ''}</a>
      <div>
        <a class="line__name" href="${p.url}" style="text-decoration:none">${esc(p.name)}</a>
        <div class="line__meta">${esc(p.variant)}</div>
        <div class="qty"><button type="button" data-line-qty="-1" aria-label="Decrease quantity of ${esc(p.name)}">−</button><input type="number" min="0" max="10" value="${i.qty}" aria-label="Quantity of ${esc(p.name)}" data-line-input><button type="button" data-line-qty="1" aria-label="Increase quantity of ${esc(p.name)}">+</button></div>
        <button class="line__remove" type="button" data-line-remove>Remove</button>
      </div>
      <div class="line__price">${fmt(p.price * i.qty)}</div>
    </div>`;
  };

  const shipMeter = () => {
    const t = D.freeShippingThreshold;
    if (!t) return '';
    const sub = Cart.total();
    const left = Math.max(0, t - sub);
    return `<div class="ship-meter">${left ? `You're ${fmt(left)} away from free shipping.` : 'Your order ships free.'}<div class="ship-meter__bar"><i style="transform:scaleX(${Math.min(1, sub / t)})"></i></div></div>`;
  };

  const totalsHTML = () => {
    const d = Cart.discount();
    return `<div class="totals">
      <div><span>Subtotal</span><span>${fmt(Cart.subtotal())}</span></div>
      ${d ? `<div><span>Bundle saving</span><span>−${fmt(d)}</span></div>` : ''}
      <div><span>Shipping</span><span class="muted">Calculated at checkout</span></div>
      <div class="grand"><span>Total</span><span>${fmt(Cart.total())}</span></div>
    </div>`;
  };

  const emptyHTML = `<div class="empty"><p>Your cart is empty.</p><a class="btn" href="${D.product.url}">Shop Nocturne</a></div>`;

  function renderCart() {
    const n = Cart.count();
    $$('[data-cart-count]').forEach((el) => {
      const prev = +el.textContent;
      el.textContent = n;
      el.classList.toggle('has-items', n > 0);
      if (n > prev && !reduce) {
        el.classList.remove('bump');
        void el.offsetWidth;
        el.classList.add('bump');
      }
    });
    $$('[data-cart-count-sr]').forEach((el) => (el.textContent = `, ${n} item${n === 1 ? '' : 's'}`));

    const targets = [
      [$('[data-cart-lines]'), $('[data-cart-foot]')],
      [$('[data-cart-page-lines]'), $('[data-cart-page-foot]')],
    ];
    for (const [lines, foot] of targets) {
      if (!lines) continue;
      if (!Cart.items.length) {
        lines.innerHTML = emptyHTML;
        foot.innerHTML = '';
        continue;
      }
      lines.innerHTML = Cart.items.map(lineHTML).join('');
      foot.innerHTML = `${shipMeter()}${totalsHTML()}
        <a class="btn btn--block" href="/checkout/">Checkout</a>
        <p class="muted small" style="text-align:center;margin:12px 0 0">Taxes, shipping and any duties shown before payment.</p>`;
    }
  }

  document.addEventListener('click', (e) => {
    const line = e.target.closest('[data-line]');
    if (!line) return;
    const id = line.dataset.line;
    const cur = Cart.items.find((i) => i.id === id);
    if (e.target.closest('[data-line-remove]')) Cart.set(id, 0);
    const step = e.target.closest('[data-line-qty]');
    if (step && cur) Cart.set(id, cur.qty + +step.dataset.lineQty);
  });
  document.addEventListener('change', (e) => {
    if (!e.target.matches('[data-line-input]')) return;
    Cart.set(e.target.closest('[data-line]').dataset.line, parseInt(e.target.value, 10) || 0);
  });
  document.addEventListener('cart:change', renderCart);
  window.addEventListener('storage', (e) => {
    if (e.key === 'norrval_cart') {
      Cart.items = store.get('norrval_cart', []);
      renderCart();
    }
  });
  renderCart();

  // ---------- dialogs: drawer + mobile menu (focus trap, Esc, restore) ----------
  const focusables = (root) =>
    $$('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])', root).filter(
      (el) => el.offsetParent !== null,
    );
  let lastFocus = null;
  let trapRoot = null;
  document.addEventListener('keydown', (e) => {
    if (!trapRoot) return;
    if (e.key === 'Escape') return closeAll();
    if (e.key !== 'Tab') return;
    const f = focusables(trapRoot);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) {
      e.preventDefault();
      f[f.length - 1].focus();
    } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
      e.preventDefault();
      f[0].focus();
    }
  });
  const lockScroll = (on) => (document.documentElement.style.overflow = on ? 'hidden' : '');

  const drawer = $('#cart-drawer');
  function openCart() {
    lastFocus = document.activeElement;
    document.body.classList.add('drawer-open');
    trapRoot = drawer;
    lockScroll(true);
    setTimeout(() => drawer.focus(), 50);
  }
  const menu = $('#mobile-nav');
  const burger = $('[data-menu-open]');
  function openMenu() {
    lastFocus = document.activeElement;
    menu.hidden = false;
    requestAnimationFrame(() => menu.classList.add('is-open'));
    burger.setAttribute('aria-expanded', 'true');
    trapRoot = menu;
    lockScroll(true);
    setTimeout(() => $('[data-menu-close]').focus(), 50);
  }
  function closeAll() {
    const wasOpen = trapRoot;
    document.body.classList.remove('drawer-open');
    if (menu.classList.contains('is-open')) {
      menu.classList.remove('is-open');
      burger.setAttribute('aria-expanded', 'false');
      setTimeout(() => (menu.hidden = true), 350);
    }
    trapRoot = null;
    lockScroll(false);
    if (wasOpen && lastFocus) lastFocus.focus();
  }
  $$('[data-cart-open]').forEach((b) => b.addEventListener('click', openCart));
  $$('[data-cart-close]').forEach((b) => b.addEventListener('click', closeAll));
  burger.addEventListener('click', openMenu);
  $('[data-menu-close]').addEventListener('click', closeAll);
  $$('#mobile-nav a').forEach((a) => a.addEventListener('click', closeAll));
  window.NorrvalOpenCart = openCart;

  // ---------- add-to-cart helper used by page scripts ----------
  window.NorrvalAdd = (id, qty) => {
    Cart.add(id, qty);
    openCart();
  };

  // ---------- header state + scroll progress ----------
  const header = $('.header');
  const bar = $('.progress');
  let ticking = false;
  function onScroll() {
    const y = scrollY;
    header.classList.toggle('is-scrolled', y > 8);
    // Header only shows at the very top of the page — scrolling back up does
    // not bring it back, only returning to y<=8 does. Intentional, not the
    // usual "hide on scroll down, show on scroll up" pattern.
    if (!trapRoot) header.classList.toggle('is-hidden', y > 8);
    const h = document.documentElement.scrollHeight - innerHeight;
    bar.style.setProperty('--p', h > 0 ? (y / h).toFixed(4) : 0);
    ticking = false;
  }
  addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(onScroll);
    }
  }, { passive: true });
  onScroll();
  header.addEventListener('focusin', () => header.classList.remove('is-hidden'));

  // ---------- reveal on scroll ----------
  const revealEls = $$('[data-reveal]');
  if (reduce || !('IntersectionObserver' in window)) {
    revealEls.forEach((el) => el.classList.add('is-in'));
  } else {
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add('is-in');
            io.unobserve(en.target);
          }
        }),
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
    );
    revealEls.forEach((el) => io.observe(el));
  }

  // ---------- parallax (transform only) ----------
  const para = $$('[data-parallax]');
  if (para.length && !reduce) {
    const tick = () => {
      for (const el of para) {
        const r = el.parentElement.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight) continue;
        const c = (r.top + r.height / 2 - innerHeight / 2) * +el.dataset.parallax;
        el.style.transform = `translate3d(0, ${c.toFixed(1)}px, 0)`;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ---------- magnetic buttons + card glow (fine pointers only) ----------
  if (fine && !reduce) {
    $$('[data-magnetic]').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left - r.width / 2) * 0.18;
        const y = (e.clientY - r.top - r.height / 2) * 0.28;
        el.style.transform = `translate(${x}px, ${y}px)`;
      });
      el.addEventListener('pointerleave', () => (el.style.transform = ''));
    });
    $$('[data-glow]').forEach((el) =>
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${e.clientX - r.left}px`);
        el.style.setProperty('--my', `${e.clientY - r.top}px`);
      }),
    );
  }

  // ---------- region & currency ----------
  const COUNTRIES = [
    'United States', 'Canada', 'United Kingdom', 'Ireland', 'Germany', 'France', 'Netherlands', 'Belgium', 'Luxembourg',
    'Spain', 'Portugal', 'Italy', 'Austria', 'Switzerland', 'Denmark', 'Sweden', 'Norway', 'Finland', 'Poland',
    'Czechia', 'Greece', 'Israel', 'United Arab Emirates', 'Saudi Arabia', 'Australia', 'New Zealand', 'Japan',
    'South Korea', 'Singapore', 'Hong Kong', 'Mexico', 'Brazil', 'South Africa', 'Other',
  ];
  const region = store.get('norrval_region', { country: '', currency: D.currency });
  $$('[data-country-select]').forEach((sel) => {
    sel.innerHTML =
      '<option value="">Select…</option>' +
      COUNTRIES.map((c) => `<option${c === region.country ? ' selected' : ''}>${c}</option>`).join('');
  });
  const regionModal = $('#region-modal');
  $$('[data-region-open]').forEach((b) => b.addEventListener('click', () => regionModal.showModal()));
  regionModal.addEventListener('close', () => {
    if (regionModal.returnValue !== 'save') return;
    const f = $('[data-region-form]');
    store.set('norrval_region', { country: f.country.value, currency: f.currency.value });
    $$('[data-region-label]').forEach((el) => (el.textContent = f.currency.value));
    toast('Region saved');
  });

  // ---------- consent ----------
  const CONSENT_KEY = 'norrval_consent';
  const banner = $('[data-consent-banner]');
  const cModal = $('#consent-modal');
  const cForm = $('[data-consent-form]');
  const readConsent = () => {
    const c = store.get(CONSENT_KEY, null);
    // Ask again after 12 months.
    if (c && Date.now() - c.ts > 365 * 864e5) return null;
    return c;
  };
  function applyConsent(c) {
    if (c && c.analytics && D.analyticsScriptUrl && !$('script[data-analytics]')) {
      const s = document.createElement('script');
      s.src = D.analyticsScriptUrl;
      s.async = true;
      s.dataset.analytics = '';
      document.head.appendChild(s);
    }
  }
  function saveConsent(analytics, marketing) {
    const c = { analytics, marketing, ts: Date.now() };
    store.set(CONSENT_KEY, c);
    banner.hidden = true;
    applyConsent(c);
  }
  const consent = readConsent();
  if (!consent) banner.hidden = false;
  else applyConsent(consent);
  $$('[data-consent]').forEach((b) =>
    b.addEventListener('click', () => {
      const yes = b.dataset.consent === 'accept';
      saveConsent(yes, yes);
      toast(yes ? 'All cookies accepted' : 'Optional cookies rejected');
    }),
  );
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-consent-open]')) return;
    const c = readConsent() || { analytics: false, marketing: false };
    cForm.analytics.checked = !!c.analytics;
    cForm.marketing.checked = !!c.marketing;
    cModal.showModal();
  });
  cModal.addEventListener('close', () => {
    if (cModal.returnValue === 'save') {
      saveConsent(cForm.analytics.checked, cForm.marketing.checked);
      toast('Cookie settings saved');
    }
  });

  // ---------- newsletter ----------
  const nl = $('[data-newsletter]');
  if (nl) {
    const msg = $('[data-nl-msg]');
    const show = (text, ok) => {
      msg.hidden = false;
      msg.textContent = text;
      msg.className = `form-msg ${ok ? 'is-ok' : 'is-err'}`;
    };
    nl.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = nl.email.value.trim();
      nl.email.setAttribute('aria-invalid', String(!nl.email.checkValidity() || !email));
      if (!email || !nl.email.checkValidity()) return show('Please enter a valid email address.', false);
      if (!nl.consent.checked) return show('Please tick the box to confirm you want to receive emails.', false);
      if (!D.newsletterEndpoint) {
        return show(`Sign-up is not open yet. In the meantime, email ${D.supportEmail} and we'll add you by hand.`, false);
      }
      try {
        const r = await fetch(D.newsletterEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ email, consent: true, consentedAt: new Date().toISOString() }),
        });
        if (!r.ok) throw new Error();
        nl.reset();
        show('Thanks — please check your inbox to confirm.', true);
      } catch {
        show('Something went wrong. Please try again in a moment.', false);
      }
    });
  }

  window.NorrvalUtil = { fmt, esc, toast, store, reduce };
})();
