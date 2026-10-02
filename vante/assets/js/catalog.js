/*
 * VANTÉ — product catalogue.
 *
 * Structure, so the range can grow without touching any page code:
 *   COLORS       every colour the store knows. Add "stone" here and it can be
 *                used by any product.
 *   SIZE_RUNS    reusable size runs per garment type.
 *   COLLECTIONS  editorial groupings; a product can sit in several.
 *   PRODUCTS     each product lists `variants`, one per colour. A variant names
 *                its images (keys in media.js) and can override price or sizes.
 *                SKUs are built as <product>-<color>-<size>.
 */
(function () {
  var COLORS = {
    black: { name: "Black", hex: "#111110" },
    white: { name: "White", hex: "#f1efea" }
  };

  var SIZE_RUNS = {
    top: ["XS", "S", "M", "L", "XL", "XXL"],
    bottom: ["S", "M", "L", "XL"]
  };

  var COLLECTIONS = {
    "marble-and-ink": {
      name: "Marble & Ink",
      kicker: "Collection 01",
      description: "Classical figures, carved light and the ink that holds them. The first chapter of the house."
    },
    "celestial": {
      name: "Celestial",
      kicker: "Line studies",
      description: "Single-line drawings of the sky and the creatures that crossed it."
    },
    "essentials": {
      name: "Essentials",
      kicker: "Signature",
      description: "The monogram and the word. Pieces built to be worn every day."
    },
    "drop-002": {
      name: "Drop 002 — Seraph",
      kicker: "Limited edition",
      description: "A numbered run. When it is gone it is not remade."
    }
  };

  var CARE = [
    "Machine wash cold, inside out, with similar colours",
    "Do not tumble dry — dry flat to keep the shape",
    "Iron inside out on low heat, never over the print",
    "Do not bleach or dry clean"
  ];

  var TEE = {
    material: "100% combed ring-spun cotton, 240 gsm heavyweight jersey",
    fit: "Oversized, dropped shoulder. Take your usual size for the intended drape, one size down for a closer fit.",
    details: ["Ribbed crew neck", "Double-needle stitched hems", "Print applied direct-to-garment, bonded to the fibre", "Made to order"]
  };
  var HOODIE = {
    material: "80% cotton, 20% recycled polyester brushed fleece, 400 gsm",
    fit: "Relaxed, dropped shoulder, ribbed cuffs and hem.",
    details: ["Lined double-layer hood", "Kangaroo pocket", "Print applied direct-to-garment", "Made to order"]
  };
  var CROPPED = {
    material: "80% cotton, 20% recycled polyester brushed fleece, 350 gsm",
    fit: "Boxy cropped silhouette, sits at the natural waist.",
    details: ["Lined hood, no drawcord", "Raw-look cropped hem with rib", "Print applied direct-to-garment", "Made to order"]
  };
  var CREW = {
    material: "80% cotton, 20% recycled polyester brushed fleece, 380 gsm",
    fit: "Relaxed, dropped shoulder, ribbed collar, cuffs and hem.",
    details: ["Twin-needle cover-stitch", "Brushed interior", "Print applied direct-to-garment", "Made to order"]
  };
  var SHORTS = {
    material: "100% cotton French terry, 300 gsm",
    fit: "Relaxed, mid-thigh length, elasticated waist with flat drawcord.",
    details: ["Side seam pockets", "Flat waist drawcord", "Print applied direct-to-garment", "Made to order"]
  };

  function bw(slug) {
    return [
      { color: "black", images: [slug + "-black"] },
      { color: "white", images: [slug + "-white"] }
    ];
  }

  var PRODUCTS = [
    {
      id: "archangel-tee", name: "Archangel Tee", category: "tees", price: 35,
      collections: ["marble-and-ink"], badge: "Signature", origin: "original",
      line: "The guardian, turned from the world, wings still open.",
      description: "A marble archangel rendered in charcoal and bone, standing with his back to you. The figure is printed across the upper back and fades into the cloth, so the statue seems to emerge from the shirt itself.",
      spec: TEE, sizeRun: "top", variants: bw("archangel-tee"), editorial: ["photo-12", "photo-01"]
    },
    {
      id: "carrara-tee", name: "Carrara Tee", category: "tees", price: 35,
      collections: ["marble-and-ink"], badge: "Best seller", origin: "original",
      line: "Named for the quarry. Cut from the same stone.",
      description: "A sculpted back in heavy drapery, drawn like a study from a cast gallery. Strength shown the quiet way — from behind, at rest.",
      spec: TEE, sizeRun: "top", variants: bw("carrara-tee"), editorial: ["photo-01", "photo-08"]
    },
    {
      id: "crowned-tee", name: "Crowned Tee", category: "tees", price: 35,
      collections: ["marble-and-ink"], origin: "original",
      line: "A crown floats above. He has not reached for it yet.",
      description: "The same sculpted figure, now under a fine-line crown and halo. A study in what we are owed and what we earn.",
      spec: TEE, sizeRun: "top", variants: bw("crowned-tee"), editorial: ["photo-08", "photo-14"]
    },
    {
      id: "pegasus-tee", name: "Pegasus Tee", category: "tees", price: 34,
      collections: ["celestial"], origin: "original",
      line: "A winged horse, drawn in a single gold line.",
      description: "Pegasus rears inside a thin architectural frame, crowned by a four-point star. Champagne line work on the back, nothing on the front.",
      spec: TEE, sizeRun: "top", variants: bw("pegasus-tee"), editorial: ["photo-06", "photo-11"]
    },
    {
      id: "celestial-tee", name: "Celestial Tee", category: "tees", price: 33,
      collections: ["celestial"], origin: "original",
      line: "Orbit, star, current — and the monogram beneath.",
      description: "A line-drawn orbit and falling star above two drifting currents, signed with the VA monogram. Drawn to be read slowly.",
      spec: TEE, sizeRun: "top", variants: bw("celestial-tee"), editorial: ["photo-06", "photo-13"]
    },
    {
      id: "summit-tee", name: "Summit Tee", category: "tees", price: 33,
      collections: ["celestial"], origin: "original",
      line: "Stay focused. The mountain does not move for you.",
      description: "A summit photographed in mist and cut into three vertical panels — one view, broken and reassembled. Printed on the back.",
      spec: TEE, sizeRun: "top", variants: bw("summit-tee"), editorial: ["photo-06", "photo-03"]
    },
    {
      id: "monogram-tee", name: "VA Monogram Tee", category: "tees", price: 32,
      collections: ["essentials"], badge: "Best seller", origin: "original",
      line: "The two letters, worn over the heart.",
      description: "The VA monogram and the VANTÉ wordmark on the left chest. The piece the rest of the wardrobe is built around.",
      spec: TEE, sizeRun: "top", variants: bw("monogram-tee"), editorial: ["photo-02", "photo-07"]
    },
    {
      id: "seraph-hoodie", name: "Seraph Hoodie", category: "hoodies", price: 55,
      collections: ["drop-002", "celestial"], badge: "Limited", origin: "original",
      limited: { edition: 150, label: "Numbered edition of 150" },
      line: "A cherub in flight, drawn in one breath of gold.",
      description: "A winged figure in fine champagne line work across the back of a heavyweight fleece hoodie. Released once, in a numbered edition.",
      spec: HOODIE, sizeRun: "top", variants: bw("seraph-hoodie"), editorial: ["photo-12", "photo-15"]
    },
    {
      id: "cropped-hoodie", name: "Signature Cropped Hoodie", category: "hoodies", price: 49,
      collections: ["essentials"], origin: "original",
      line: "The name, spaced wide across the back.",
      description: "A boxy cropped hoodie with VANTÉ set wide across the shoulders. Quiet from the front, certain from behind.",
      spec: CROPPED, sizeRun: "top", variants: bw("cropped-hoodie"), editorial: ["photo-07", "photo-14"]
    },
    {
      id: "signature-shorts", name: "Signature Shorts", category: "shorts", price: 24,
      collections: ["essentials"], origin: "original",
      line: "VANTÉ — made to be you, on the leg.",
      description: "Heavy French-terry shorts carrying the wordmark and the line beneath it, set low on the right leg.",
      spec: SHORTS, sizeRun: "bottom", variants: bw("signature-shorts"), editorial: ["photo-07", "photo-02"]
    },
    {
      id: "monogram-shorts", name: "VA Monogram Shorts", category: "shorts", price: 22,
      collections: ["essentials"], origin: "original",
      line: "The monogram, oversized.",
      description: "The VA monogram drawn large on the left leg of heavyweight French-terry shorts.",
      spec: SHORTS, sizeRun: "bottom", variants: bw("monogram-shorts"), editorial: ["photo-15", "photo-08"]
    },

    /* ---- New for the season ---- */
    {
      id: "icarus-tee", name: "Icarus Tee", category: "tees", price: 35,
      collections: ["celestial"], badge: "New", origin: "new",
      line: "He flew too close. We drew him anyway.",
      description: "Icarus in descent beside a great thin sun, drawn in the same champagne line as Pegasus. A new study for the Celestial line.",
      spec: TEE, sizeRun: "top", variants: bw("icarus-tee"), editorial: ["photo-13", "photo-06"]
    },
    {
      id: "atlas-tee", name: "Atlas Tee", category: "tees", price: 35,
      collections: ["marble-and-ink"], badge: "New", origin: "new",
      line: "Carry your world. Kneel if you must.",
      description: "Atlas, kneeling under the celestial sphere, rendered in charcoal and marble white. A companion piece to the Carrara and Archangel tees.",
      spec: TEE, sizeRun: "top", variants: bw("atlas-tee"), editorial: ["photo-01", "photo-15"]
    },
    {
      id: "monogram-crewneck", name: "VA Monogram Crewneck", category: "sweatshirts", price: 49,
      collections: ["essentials"], badge: "New", origin: "new",
      line: "One mark, small, where it matters.",
      description: "A heavyweight crewneck with the VA monogram set small on the left chest. The quietest piece in the house.",
      spec: CREW, sizeRun: "top", variants: bw("monogram-crewneck"), editorial: ["photo-14", "photo-02"]
    },
    {
      id: "signature-crewneck", name: "Made To Be You Crewneck", category: "sweatshirts", price: 52,
      collections: ["essentials"], badge: "New", origin: "new",
      line: "The name and the promise, centred.",
      description: "VANTÉ above a fine rule and the line that started it all — Made to be you — across the chest of a heavyweight crewneck.",
      spec: CREW, sizeRun: "top", variants: bw("signature-crewneck"), editorial: ["photo-08", "photo-07"]
    }
  ];

  var CATEGORIES = {
    tees: "T-Shirts",
    hoodies: "Hoodies",
    sweatshirts: "Sweatshirts",
    shorts: "Shorts"
  };

  function product(id) {
    for (var i = 0; i < PRODUCTS.length; i++) if (PRODUCTS[i].id === id) return PRODUCTS[i];
    return null;
  }
  function variant(p, color) {
    for (var i = 0; i < p.variants.length; i++) if (p.variants[i].color === color) return p.variants[i];
    return p.variants[0];
  }
  function sizes(p, v) { return (v && v.sizes) || SIZE_RUNS[p.sizeRun]; }
  function price(p, v) { return (v && v.price) || p.price; }
  function image(key) { return (window.VANTE_MEDIA || {})[key] || ""; }
  function sku(p, color, size) { return p.id + "-" + color + "-" + size; }

  window.VANTE_CATALOG = {
    COLORS: COLORS, SIZE_RUNS: SIZE_RUNS, COLLECTIONS: COLLECTIONS,
    CATEGORIES: CATEGORIES, PRODUCTS: PRODUCTS, CARE: CARE,
    product: product, variant: variant, sizes: sizes, price: price,
    image: image, sku: sku
  };
})();
