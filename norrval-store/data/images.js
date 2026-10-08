/**
 * Image registry. Each slot is generated for the exact container it fills —
 * no slot is a crop of another. `ratio` is the container's aspect ratio and the
 * ratio the image was (or must be) generated at.
 *
 * Files live in assets/source/<slot>.png (the original generation). Run
 * `npm run images` to produce the responsive AVIF / WebP / JPEG set in
 * assets/img/. A slot whose source file is missing falls back to `fallback`
 * (or a neutral placeholder) so the site never shows a broken image.
 *
 * All prompts use the uploaded product photo as the reference image. The
 * presentation box lid is always rendered plain — the logo on the supplier's
 * box is not ours to use.
 */

// Generated shots to pass as extra references (as job IDs) when generating
// the remaining slots, so the watch stays identical across the set. The
// original product photo (media 084114f4-f59a-4c73-8ce1-0a851efc71eb) is
// always the first reference.
export const REFERENCE_JOBS = {
  product: 'a469b238-4336-4ef9-8c5e-691a477d151d',
  heroMobile: 'fc81b902-a25a-4391-a968-a9e97d75d568',
  lifestyle: '5f53cbdc-ac51-469e-a34d-0cd5b7c5b477',
  gift: 'b1d4ac43-90b6-43d9-8ecd-5511293b4884',
};

const WATCH =
  'the exact wristwatch from the reference image — round matte black case, black dial with slim markers and teal-blue accented hands and markers, one small sub-dial on the lower left of the dial, black Milanese mesh bracelet. Keep design, colours, proportions and dial layout identical to the reference; do not redesign it; no logos or text on the dial beyond what the reference shows';

export const IMAGES = {
  'hero-desktop': {
    ratio: [16, 9],
    alt: 'NORRVAL Nocturne black watch on dark stone, lit with a cool blue rim light',
    position: '70% 50%',
    fallback: null,
    higgsfieldJob: '96b90dd5-7c98-4744-93b5-a5d80ae20da8',
    prompt: `Luxury watch campaign photograph, wide 16:9 website hero. Product: ${WATCH}. Composition: the watch sits in the RIGHT third of the frame, three-quarter angle, bracelet curving naturally, fully inside the frame with generous margins. The LEFT half is calm near-black empty space for website headline text. Environment: dark charcoal studio, black textured stone surface, subtle cool blue/teal rim light and soft reflections, faint haze. Dramatic but realistic lighting, shallow depth of field, photorealistic commercial product photography. No text, no watermark, no presentation box, no beaded bracelet.`,
  },
  'hero-mobile': {
    ratio: [4, 5],
    alt: 'NORRVAL Nocturne black watch, three-quarter view on a dark studio surface',
    position: '50% 30%',
    fallback: 'hero-desktop',
    higgsfieldJob: 'fc81b902-a25a-4391-a968-a9e97d75d568',
    prompt: `Mobile website hero photograph, vertical 4:5. ${WATCH} — large and clearly readable, positioned in the UPPER 60 percent of the frame, three-quarter angle, bracelet curving downward, fully in frame with side margins. The LOWER 35 percent is calm near-black empty space for headline text. Environment: dark charcoal studio, black textured stone surface, subtle cool blue/teal rim light, faint haze. Photorealistic luxury product photography. No text, no watermark, no box, no beaded bracelet.`,
  },
  closeup: {
    ratio: [4, 5],
    alt: 'Close-up of the Nocturne black dial with teal-accented hands and the small sub-dial',
    position: '50% 50%',
    fallback: 'product',
    higgsfieldJob: null,
    prompt: `Macro detail photograph, vertical 4:5. Extreme close-up of ${WATCH}. Dial fills most of the frame but the case edge stays visible; slight angle so crystal reflections show. Premium dark studio, soft graded black background, cool blue highlight streak across the crystal, fine mesh texture visible. Photorealistic macro, crisp focus on the dial. No text, no watermark.`,
  },
  lifestyle: {
    ratio: [4, 5],
    alt: 'Man in a charcoal overshirt adjusting his cuff on a city street at dusk, wearing the Nocturne',
    position: '50% 60%',
    fallback: null,
    higgsfieldJob: '5f53cbdc-ac51-469e-a34d-0cd5b7c5b477',
    prompt: `Editorial lifestyle photograph, vertical 4:5. A stylish man in his late twenties wearing ${WATCH} on his left wrist, correctly scaled to a real wrist. He wears a charcoal overshirt over a black t-shirt, on a city street at dusk, adjusting his cuff so the watch is clearly visible in the lower-middle of the frame. Face turned away or cropped above the jaw. Background: blurred city lights, concrete and glass architecture, cool blue evening tones. Natural human proportions, anatomically correct hands, candid premium fashion photography. No text, no logos, no watermark.`,
  },
  business: {
    ratio: [4, 5],
    alt: 'Man in a navy suit at a desk in the evening, the Nocturne visible below his shirt cuff',
    position: '50% 55%',
    fallback: 'lifestyle',
    higgsfieldJob: null,
    prompt: `Business editorial photograph, vertical 4:5. A man in a tailored navy suit and white shirt, seated at a dark wood desk in a modern office at early evening, left forearm resting on the desk, wearing ${WATCH}, realistically sized, clearly visible below the shirt cuff in the centre of the frame. Warm window light mixed with cool city light through floor-to-ceiling glass, shallow depth of field, face cropped out above the chin. Natural hands. No text, no logos, no watermark.`,
  },
  gift: {
    ratio: [4, 5],
    alt: 'The Nocturne and a black beaded bracelet in an open black presentation box on a walnut table',
    position: '50% 50%',
    fallback: null,
    higgsfieldJob: 'b1d4ac43-90b6-43d9-8ecd-5511293b4884',
    prompt: `Gift / unboxing product photograph, vertical 4:5. The exact contents shown in the reference image: the matte black square presentation box with its lid open, the black watch resting on the black cushion, and the black beaded bracelet with silver spacer beads beside it. Keep watch, bracelet and box shape identical to the reference. The box lid is completely plain matte black — no emblem, no text. Setting: dark walnut table, folded charcoal linen, a sprig of dried eucalyptus, warm candle glow and cool rim light. Box centred, whole box in frame. Photorealistic. No text, no watermark.`,
  },
  product: {
    ratio: [1, 1],
    alt: 'NORRVAL Nocturne front view: black dial, teal hands, black mesh bracelet',
    position: '50% 50%',
    fallback: 'hero-mobile',
    higgsfieldJob: 'a469b238-4336-4ef9-8c5e-691a477d151d',
    prompt: `Clean e-commerce product photograph, square 1:1. ${WATCH}, front-facing, centred, standing upright with the mesh bracelet forming a closed loop behind the case. Watch occupies about 65 percent of the frame height with even margins. Smooth dark charcoal gradient background, soft even studio lighting, subtle blue reflection on the crystal, soft contact shadow. Photorealistic catalogue image. No text, no watermark, no box.`,
  },
  side: {
    ratio: [1, 1],
    alt: 'Side profile of the Nocturne showing the case edge, crown and case thickness',
    position: '50% 50%',
    fallback: null,
    higgsfieldJob: null,
    prompt: `Product photograph, square 1:1, low side-angle profile of ${WATCH}, showing the case side, crown and case thickness, mesh bracelet curving away. Do not invent extra pushers, engravings, logos or text. Centred with generous margins. Dark graphite background, thin cool blue edge light outlining the case profile, soft reflection on glossy black surface. Photorealistic. No text, no watermark.`,
  },
  wrist: {
    ratio: [4, 5],
    alt: 'The Nocturne on a wrist resting beside a black coffee cup in soft daylight',
    position: '50% 40%',
    fallback: null,
    higgsfieldJob: null,
    prompt: `Natural wrist close-up photograph, vertical 4:5. A man's left wrist and hand wearing ${WATCH}, realistically scaled. Dark grey knit sleeve pushed back slightly. Hand relaxed on a matte stone surface near a black coffee cup, soft window daylight, natural skin, anatomically correct hand. Watch in the upper-middle of the frame, sharp; background softly blurred. Photorealistic. No text, no logos, no watermark.`,
  },
  ad: {
    ratio: [1, 1],
    alt: 'NORRVAL Nocturne advertising image',
    position: '50% 40%',
    fallback: null,
    higgsfieldJob: null,
    usedOnSite: false, // for paid social; also used as the Open Graph image when present
    prompt: `Premium advertising composition, square 1:1. ${WATCH}, floating at a dynamic diagonal angle in the upper-centre of the frame. Deep black background with a single sweeping arc of cool teal light behind the watch and fine specular reflections. Bottom quarter is clean dark space reserved for short ad copy. Whole watch inside the frame with safe margins. Photorealistic. No text, no logo, no watermark.`,
  },
};

// Widths produced by scripts/images.py for every slot.
export const WIDTHS = [480, 768, 1080, 1440, 2000];
