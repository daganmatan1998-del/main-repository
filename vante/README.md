# VANTÉ — online store

A static, build-free storefront for VANTÉ: cinematic home page, shop with filters, product pages, bag, checkout, account (saved pieces), and the full set of legal pages for an Israeli business shipping to the United States, Israel and the Gulf.

Open `index.html` through any static web server (`python3 -m http.server` in this folder). Opening the file directly from disk also works, but some browsers block storage on `file://`, which empties the bag on reload.

## Before launch — checklist

1. **Business details.** Fill every `[[…]]` value in `assets/js/config.js → business`: registered name, company / Osek number, address, phone, accessibility coordinator. They appear automatically in every legal page, highlighted until filled.
2. **Legal review.** The policies were written for this business model (Israeli seller, print-on-demand, DDU shipping), but they are not legal advice. Have an Israeli lawyer review `terms`, `returns`, `privacy` and `accessibility` before going live.
3. **Payments.** Deploy `worker/` to Cloudflare (`npx wrangler deploy`), add your Stripe key with `npx wrangler secret put STRIPE_SECRET_KEY`, set `SITE_URL` / `ALLOWED_ORIGIN` in `worker/wrangler.toml`, then paste the worker URL into `config.js → checkout.endpoint`. Until then, checkout politely says payments are not switched on and gives your email.
4. **Fulfilment.** Connect paid Stripe orders to your print-on-demand provider: each Checkout Session carries `metadata.items` (`id:color:size:qty`) and the shipping address. A Stripe webhook or Zapier/Make flow can forward it.
5. **Newsletter / contact.** Optional endpoints in `config.js → newsletter.endpoint` and `contact.endpoint`. Without them both forms open the visitor's email app — nothing is faked.
6. **Images.** Images are served from the Higgsfield CDN. To host them yourself run `bash tools/download-assets.sh`, which downloads everything into `assets/media/` and rewrites the links.
7. **Domain.** Replace `https://YOUR-DOMAIN` in `sitemap.xml` and `worker/wrangler.toml`.

## How it is organised

| Path | What it is |
| --- | --- |
| `assets/js/config.js` | Business details, shipping zones and rates, free-shipping threshold, endpoints |
| `assets/js/catalog.js` | Colours, size runs, collections, products and variants |
| `assets/js/media.js` | Every image URL, keyed by name (`archangel-tee-black`, `photo-08`…) |
| `assets/js/store.js` | Bag, saved pieces, consent, money formatting, shipping quotes |
| `assets/js/ui.js` | Header, footer, bag drawer, fly-to-bag, search, quick view, cookie banner, transitions, motion helpers |
| `assets/js/home.js` · `shop.js` · `product.js` · `checkout.js` | Page scripts |
| `assets/css/vante.css` | The whole design system |
| `worker/checkout-worker.js` | Stripe Checkout endpoint, re-prices every order server-side |
| `tools/check-worker-sync.mjs` | Fails if worker prices drift from the catalogue |

## Adding things

**A new colour (e.g. stone):** add it to `COLORS` in `catalog.js`, add `"<product>-stone"` image keys to `media.js`, add `{ color: "stone", images: ["<product>-stone"] }` to the product's `variants`, and add `"stone"` to that product's `colors` in the worker. Swatches, filters, search and checkout pick it up automatically.

**A new product:** add images to `media.js`, an entry to `PRODUCTS` in `catalog.js`, the same id and price to the worker, then run `node tools/check-worker-sync.mjs`.

**A new country:** add it to a zone (or a new zone) in `config.js → shipping` and in the worker's `SHIPPING`. The shipping policy table, checkout and country list update themselves.

## Notes

- Motion uses GSAP + ScrollTrigger and Lenis (vendored in `assets/vendor/`). With “reduce motion” enabled, every scene falls back to a static layout.
- Fonts (Cormorant Garamond, Jost) are self-hosted under the SIL Open Font License, so no third-party font requests are made.
- Storage used is listed in the Cookie Policy; there are no analytics or ad trackers. If you add any, load them only when `VANTE.consent.allowed("analytics")` (or `"marketing"`) is true, and list them in `cookies.html`.
