/*
 * VANTÉ — media manifest.
 * One place for every image the site loads, keyed by name. Product shots are
 * keyed "<product>-<color>" so a new colorway is one new line here plus one new
 * variant in catalog.js. To self-host, run tools/download-assets.sh, which saves
 * every file below into assets/media/ and rewrites BASE to point there.
 */
(function () {
  var CDN = "https://d2ol7oe51mr4n9.cloudfront.net/user_3K70xdjoxT2wOnGeYJ8ZVc4zRHa/";
  var src = function (id, ext) { return CDN + id + "." + (ext || "webp"); };

  window.VANTE_MEDIA = {
    /* ---- Product cut-outs (transparent background, 1100px) ---- */
    "monogram-tee-black": src("106bb58e-0390-415d-ad1b-a96e8ceed6d4"),
    "monogram-tee-white": src("8782a4c3-f763-416f-a83b-9d48ab691f3b"),
    "signature-shorts-black": src("668d5cf6-ad7f-47bc-b4a7-109b78f22c1b"),
    "signature-shorts-white": src("8f5e1488-fe60-43f0-82be-92bed36a96e6"),
    "monogram-shorts-black": src("26e15beb-c77d-476b-be7c-3d68fe68d7de"),
    "monogram-shorts-white": src("9b1bc796-4f01-4d5b-9581-96ad7f1e9ec6"),
    "carrara-tee-black": src("b0d7a8a7-892d-4fd5-8b8e-eac68d4eca65"),
    "carrara-tee-white": src("f9a2ad5e-d26e-46c3-b709-0cfac28ed6e3"),
    "pegasus-tee-black": src("bd0f7d19-18a7-421f-9f73-20de0be67be3"),
    "pegasus-tee-white": src("c7ae6d66-9d8b-4f18-a540-fcf6ca0c07c5"),
    "crowned-tee-black": src("6f12a9fb-5b12-47f7-be32-b8d9727b1cfe"),
    "crowned-tee-white": src("8de93ec4-dd15-4133-b3f2-eb9dd5013a2d"),
    "seraph-hoodie-black": src("380a2993-f92e-4064-b6f1-941f2e5a9b65"),
    "seraph-hoodie-white": src("33a3b1d2-485d-44a6-8fd7-5c2c2a9037b2"),
    "archangel-tee-black": src("08debb68-940d-4cb2-b038-7ca5b319e956"),
    "archangel-tee-white": src("41d85910-8a4b-4c04-a118-4913078ed7cd"),
    "cropped-hoodie-black": src("dbf488e4-f500-4cf2-88ca-0a23887eb64b"),
    "cropped-hoodie-white": src("461a9af9-9716-40f2-ad63-45eb9d763d7f"),
    "celestial-tee-black": src("a9d0c592-28c1-4307-a480-c62a09b182d5"),
    "celestial-tee-white": src("5f9baec0-ac63-4991-993e-e0679328a6d5"),
    "summit-tee-black": src("426748fa-5882-421d-a8bb-883e39214dd4"),
    "summit-tee-white": src("e410d84d-4832-4665-96a3-09671570f88d"),

    /* ---- New designs for the season ---- */
    "icarus-tee-black": src("4e0bea48-a3b0-449c-a541-738bea7ca3e5"),
    "icarus-tee-white": src("caccc34d-2c8f-4100-9f0b-98344f130244"),
    "atlas-tee-black": src("11a787ee-5072-47b0-8ee3-cf9f77577ad1"),
    "atlas-tee-white": src("6eeacaaf-4755-4598-8038-af8f24754258"),
    "monogram-crewneck-black": src("723c32b1-b107-4057-ad1d-1a0439efac43"),
    "monogram-crewneck-white": src("49e9ad1b-0191-4da7-878a-8aa4ddcff87d"),
    "signature-crewneck-black": src("fdd0e878-0ec9-4b6e-988e-ea265734cd53"),
    "signature-crewneck-white": src("c171e6cd-ea9e-4ef2-adae-38f9918383a1"),

    /* ---- Campaign photography (landscape 1920w, portrait 1200h) ---- */
    "photo-00": src("69d2ab84-893d-4514-a5b3-dfe03a86c225"),
    "photo-01": src("c42e634b-262e-4916-ba2d-4cadd5086a7d"),
    "photo-02": src("8a2fc6b2-6ab8-418e-8ec1-caf1e65c5380"),
    "photo-03": src("af1cb37e-8e01-4d0e-b0c7-bbf1e19dfaf4"),
    "photo-06": src("7f0a428c-7153-4c38-8e9d-1b8190b10bbc"),
    "photo-07": src("250c6a98-881a-4db6-8d27-c4c91dda0ceb"),
    "photo-08": src("7208a3cf-3a5d-43a2-b0ac-39f3cdd305f0"),
    "photo-09": src("52df590c-a58e-4352-add3-58f2233da777"),
    "photo-10": src("c851a7cb-19ac-408d-9239-a13932256a5f"),
    "photo-11": src("1a2c1ac9-8735-48b3-be55-627bd5763151"),
    "photo-12": src("9e65186b-217b-4a89-aa24-9594fd8ecee6"),
    "photo-13": src("61bd9497-da7d-450d-b3bb-d3baac2be811"),
    "photo-14": src("5cdedf9c-c189-48d3-a1b2-62d7ede79d09"),
    "photo-15": src("949ca2bd-eb31-47e0-9913-1ecdd85579ca"),

    /* ---- Brand marks ---- */
    "mark-va-cream": src("ac731554-f1ec-458f-9529-c4ffd8e37592"),
    "mark-va-ink": src("500c8ad6-4241-4915-b980-7e78ba3f4888")
  };

  /*
   * Intrinsic sizes, so every image reserves its box before it loads (no layout
   * shift). Product cut-outs are all fitted to 1100px on the long side.
   */
  window.VANTE_MEDIA_SIZE = {
    "photo-00": [1920, 1080], "photo-01": [1920, 1080], "photo-02": [900, 1200],
    "photo-03": [900, 1200], "photo-06": [900, 1200], "photo-07": [800, 1200],
    "photo-08": [800, 1200], "photo-09": [1920, 1114], "photo-10": [1920, 1114],
    "photo-11": [1920, 1080], "photo-12": [900, 1200], "photo-13": [1920, 1080],
    "photo-14": [800, 1200], "photo-15": [800, 1200], "mark-va-cream": [133, 147],
    "mark-va-ink": [133, 147]
  };
})();
