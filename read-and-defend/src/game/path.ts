/**
 * The road enemies walk: a Catmull-Rom curve through a few control points,
 * sampled into a polyline with an arc-length table so progress 0..1 maps to
 * an even walking speed. Layout adapts to landscape vs portrait and mirrors
 * for right-to-left languages.
 */
export interface Pt { x: number; y: number }

export interface Field { x: number; y: number; w: number; h: number }

export interface SceneLayout {
  portrait: boolean;
  rtl: boolean;
  field: Field;
  /** Pixel size unit for characters and castle. */
  unit: number;
  castle: { x: number; y: number; scale: number };
  gate: Pt;
  path: Pt[];
  lengths: number[];
  total: number;
}

function catmull(points: Pt[], samplesPerSeg = 24): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s / samplesPerSeg, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** `portrait` follows the screen, not the field, so the scene never flips mid-level. */
export function computeLayout(field: Field, rtl: boolean, portrait = field.h > field.w * 0.95): SceneLayout {
  // Characters scale with the play area so they stay readable on phones.
  const unit = Math.max(22, portrait ? Math.min(field.w / 7, field.h / 7.5) : Math.min(field.w / 13, field.h / 5.6));
  const fx = (x: number) => (rtl ? field.x + field.w - x * field.w : field.x + x * field.w);
  const fy = (y: number) => field.y + y * field.h;
  let ctrl: Pt[];
  let castle: SceneLayout['castle'];
  let gate: Pt;
  if (portrait) {
    const cs = Math.min(field.w / 5.5, field.h / 4.2) / 52;
    castle = { x: field.x + field.w / 2, y: fy(0.97), scale: cs };
    gate = { x: castle.x, y: castle.y - 4 * cs };
    ctrl = [
      { x: fx(0.75), y: field.y - unit * 2 },
      { x: fx(0.78), y: fy(0.12) },
      { x: fx(0.22), y: fy(0.3) },
      { x: fx(0.78), y: fy(0.5) },
      { x: fx(0.3), y: fy(0.66) },
      { x: gate.x, y: gate.y - unit * 0.2 },
    ];
  } else {
    const cs = Math.min(field.h / 3.4, field.w / 5.2) / 52;
    const cx = fx(0.12);
    castle = { x: cx, y: fy(0.86), scale: cs };
    gate = { x: cx + (rtl ? -1 : 1) * 26 * cs, y: castle.y - 3 * cs };
    ctrl = [
      { x: rtl ? field.x - unit * 2 : field.x + field.w + unit * 2, y: fy(0.42) },
      { x: fx(0.86), y: fy(0.36) },
      { x: fx(0.7), y: fy(0.62) },
      { x: fx(0.52), y: fy(0.38) },
      { x: fx(0.36), y: fy(0.7) },
      { x: gate.x + (rtl ? -1 : 1) * unit * 0.4, y: gate.y },
    ];
  }
  const path = catmull(ctrl);
  const lengths = [0];
  for (let i = 1; i < path.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  }
  return { portrait, rtl, field, unit, castle, gate, path, lengths, total: lengths[lengths.length - 1] };
}

/** Position and heading at fraction p of the road. */
export function pointAt(l: SceneLayout, p: number): { x: number; y: number; dx: number; dy: number } {
  const d = Math.max(0, Math.min(1, p)) * l.total;
  let lo = 0, hi = l.lengths.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (l.lengths[mid] < d) lo = mid; else hi = mid;
  }
  const a = l.path[lo], b = l.path[hi];
  const seg = l.lengths[hi] - l.lengths[lo] || 1;
  const t = (d - l.lengths[lo]) / seg;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: b.x - a.x, dy: b.y - a.y };
}
