/* =====================================================================
   JARVIS GESTURE ZOOM — two hands, two pinches, stretch to zoom; and
   PRECISE CONTROL (2.12.0) — one hand, one pinch, turn a 3D model.

   Loaded by camera.html, the one window that owns the camera stream (two
   webviews cannot share a MediaStream, so hand tracking has to live where
   the pictures are). The pipeline, one stage per section below:

     HAND TRACKING      MediaPipe HandLandmarker, vendored, run locally
       -> PINCH         per hand: thumb tip to index tip, over palm length,
                        with hysteresis, a fist guard and debouncing
       -> DISTANCE      between the two pinch points, over hand size, so
                        leaning toward the camera is not a zoom
       -> SMOOTHING     One Euro filter
       -> GESTURE       idle -> arming (fresh baseline) -> armed -> zooming,
                        one zoom step per ~1 cm the hands move apart or
                        together; ended the moment either hand lets go
       -> FOREGROUND    Rust's zoom_target: which window, which program
       -> ADAPTER       browser / document / image / 3D / our own viewer /
                        generic, chosen from the program, never hard-coded
       -> CONTENT ZOOM  Rust's zoom_send (the OS input that program reads
                        as zoom), or straight into our own 3D viewer

   PRECISE CONTROL (2.12.0): ONE pinch, the other hand open or out of view,
   held a moment -> the palm centre's movement turns JARVIS's 3D model the
   same way, in any direction (jarvis://model-rotate). Two pinches are
   always a zoom, and after a zoom nothing turns until both hands open.
   Only 3D models: with no model window open it does nothing.

   Hands are measured WHOLE (2.12.0): size from the wrist to all four
   knuckles, in 3D when the tracker gives depth, so a tilted hand is not a
   smaller hand; position from the palm centre, which holds still while
   the fingers move; and all 21 points drawn over the picture.

   The window itself is never moved or resized: every adapter changes the
   zoom of what is INSIDE the window.

   Everything above the tracker is plain logic with no DOM, so the tests
   drive it with real landmarks from real photos, frame by frame.
   ===================================================================== */
(function(root){
  'use strict';

  /* ------------------------------------------------------------------
     SETTINGS — sensible without being touched.
  ------------------------------------------------------------------ */
  const DEFAULTS = Object.freeze({
    enabled: true,      // runs whenever the camera window is open
    sensitivity: 1.0,   // zoom steps per centimetre the hands move apart or together
    threshold: 5,       // millimetres of movement ignored at the start of each pinch
    smoothing: 0.5,     // 0 = raw and quick, 1 = very smooth and a little late
    maxSpeed: 6,        // at most this many zoom steps a second
    maxZoom: 5,         // 500 %, relative to where JARVIS first found the window
    minZoom: 0.25,      // 25 %
    turnEnabled: true,  // precise control: one pinch turns a 3D model
    turnScreen: 0.75,   // the share of the picture the hand crosses for one full turn (360°)
    scrollSpeed: 1,     // one pinched hand scrolling anything else: 1 = a quarter of the picture is 4 wheel notches
    pointerEnabled: true, // in the Agent Atlas: one finger is the mouse, folding it clicks
    trackWidth: 960,    // on the CPU path the picture is read at this width (0 = as the camera gives it): same hand, ~30% faster
    oneHandPointing: true, // while the finger is the mouse only that hand is tracked: the second-hand search costs about half the time
    bumpEnabled: true     // two fists brought together until they touch minimise the window he is in
  });
  const LIMITS = {
    sensitivity: [0.25, 3], threshold: [0, 30], smoothing: [0, 1],
    maxSpeed: [1, 15], maxZoom: [1.2, 20], minZoom: [0.05, 0.9], turnScreen: [0.25, 1.5], scrollSpeed: [0.25, 4]
  };
  const STORE_KEY = 'jarvis_store:gesture_zoom';

  function normaliseSettings(s){
    const out = Object.assign({}, DEFAULTS);
    if(s && typeof s === 'object'){
      if(typeof s.enabled === 'boolean') out.enabled = s.enabled;
      if(typeof s.turnEnabled === 'boolean') out.turnEnabled = s.turnEnabled;
      if(typeof s.pointerEnabled === 'boolean') out.pointerEnabled = s.pointerEnabled;
      if(typeof s.oneHandPointing === 'boolean') out.oneHandPointing = s.oneHandPointing;
      if(typeof s.bumpEnabled === 'boolean') out.bumpEnabled = s.bumpEnabled;
      if(isFinite(Number(s.trackWidth))) out.trackWidth = Number(s.trackWidth) <= 0 ? 0 : clamp(Number(s.trackWidth), 320, 1920);
      for(const k of Object.keys(LIMITS)){
        const v = Number(s[k]);
        if(isFinite(v)) out[k] = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], v));
      }
    }
    return out;
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); const m = s.length >> 1;
                           return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  /* ------------------------------------------------------------------
     SMOOTHING — the One Euro filter (Casiez et al.): heavy smoothing when
     the hands are still, so tracker jitter never reaches the zoom, and
     little when they move, so a real stretch is not dragged behind.
  ------------------------------------------------------------------ */
  class LowPass {
    constructor(){ this.y = null; }
    filter(x, a){ this.y = this.y === null ? x : a * x + (1 - a) * this.y; return this.y; }
    reset(){ this.y = null; }
  }
  class OneEuro {
    constructor(minCutoff, beta, dCutoff){
      this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff || 1;
      this.x = new LowPass(); this.dx = new LowPass(); this.t = null;
    }
    alpha(cutoff, dt){ const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
    filter(value, tMs){
      if(this.t === null){ this.t = tMs; this.dx.filter(0, 1); return this.x.filter(value, 1); }
      const dt = Math.max(1e-3, (tMs - this.t) / 1000);
      this.t = tMs;
      const prev = this.x.y;
      const d = this.dx.filter((value - prev) / dt, this.alpha(this.dCutoff, dt));
      const cutoff = this.minCutoff + this.beta * Math.abs(d);
      return this.x.filter(value, this.alpha(cutoff, dt));
    }
    reset(){ this.x.reset(); this.dx.reset(); this.t = null; }
  }

  /* ------------------------------------------------------------------
     ONE HAND — measured WHOLE, in units of its own palm, so the numbers
     mean the same near the camera and far from it.

     Since 2.12.0 the palm is not one finger's bone: it is the wrist to all
     four knuckles, averaged (x PALM_RAY, so the unit is still about a palm
     length, wrist to the middle knuckle, PALM_CM), and measured in 3D when
     the tracker gives depth (z is on the same scale as x). A hand tilted
     toward or away from the camera is foreshortened on the picture, not in
     3D: on a real side-on hand the 2D length-to-width ratio read 5.6
     against 1.3 for a hand facing the camera, and 1.26 with depth. So a
     tilt is no longer a smaller hand, a pinch that is no pinch, or a zoom.

     Measured on real MediaPipe landmarks, with depth:
       OK sign (a real pinch)   pinch 0.13-0.23
       relaxed open hands       0.39-0.46
       open / pointing          1.0 and up
       a FIST                   0.19 — which is why the fist guard exists:
     in a pinch the index tip is away from its own knuckle and the thumb
     tip away from the index knuckle (0.52-0.73 on the OK signs); a fist
     folds both in (0.14-0.19 flat, up to 0.31 with depth), hence the
     guard at 0.38, between the two.

     The palm CENTRE (wrist and the four knuckles) is where the hand is: it
     holds still while the fingers pinch and curl, which the pinch point
     does not. Hands are told apart and precise control follows it.
  ------------------------------------------------------------------ */
  const PINCH_ON = 0.30, PINCH_OFF = 0.42, FIST_GUARD = 0.38, PALM_RAY = 1.03;

  function handMetrics(landmarks, width, height){
    if(!landmarks || landmarks.length < 21) return null;
    const deep = typeof landmarks[0].z === 'number' && typeof landmarks[8].z === 'number';
    const P = landmarks.map(p => ({ x: p.x * width, y: p.y * height, z: deep ? (Number(p.z) || 0) * width : 0 }));
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const scale = (d(P[0], P[5]) + d(P[0], P[9]) + d(P[0], P[13]) + d(P[0], P[17])) / 4 * PALM_RAY;
    if(!(scale > 1)) return null;
    const C = [0, 5, 9, 13, 17];
    /* How straight each finger is (2.16.0): the wrist to its tip over the
       wrist to its middle joint, in 3D. Measured on MediaPipe's own photos:
       a straight finger reads 1.17-1.41, a folded one 0.60-0.75, the index
       bent round into an OK sign 1.01-1.04. */
    const straight = (pip, tip) => d(P[0], P[tip]) / Math.max(1e-6, d(P[0], P[pip]));
    /* How far each finger is BENT (2.18.0), in degrees: the way its end
       points (middle joint to tip) against the palm's own line (wrist to
       the middle knuckle), with the sideways spread taken out — a finger
       fanned out is not bent. Measured in 3D on MediaPipe's own photos: a
       straight index 4-12°, a relaxed one 36-46°, an OK sign 116°, a fist
       162°. The distance ratio above cannot see a bend at the big knuckle
       at all: the real pointing hand bent 90° there still read 1.20,
       "straight", which is why folding to click needed a whole curl. */
    const vec = (a, b) => ({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z });
    const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
    const unit = (a) => { const l = Math.sqrt(dot(a, a)) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
    const along = unit(vec(P[0], P[9]));
    let across = vec(P[17], P[5]);
    const ak = dot(across, along);
    across = unit({ x: across.x - along.x * ak, y: across.y - along.y * ak, z: across.z - along.z * ak });
    const bent = (pip, tip) => {
      let f = vec(P[pip], P[tip]);
      if(deep){ const s = dot(f, across); f = { x: f.x - across.x * s, y: f.y - across.y * s, z: f.z - across.z * s }; }
      return Math.acos(clamp(dot(unit(f), along), -1, 1)) * 180 / Math.PI;
    };
    return {
      scale, deep,
      fingers: { index: straight(6, 8), middle: straight(10, 12), ring: straight(14, 16), pinky: straight(18, 20) },
      bends: { index: bent(6, 8), middle: bent(10, 12), ring: bent(14, 16), pinky: bent(18, 20) },
      pinch: d(P[4], P[8]) / scale,
      indexReach: d(P[8], P[5]) / scale,
      thumbReach: d(P[4], P[5]) / scale,
      point: { x: (P[4].x + P[8].x) / 2, y: (P[4].y + P[8].y) / 2 },
      center: { x: C.reduce((a, i) => a + P[i].x, 0) / 5, y: C.reduce((a, i) => a + P[i].y, 0) / 5 },
      pts: P.map(p => ({ x: p.x, y: p.y }))
    };
  }

  /* Hysteresis (on below 0.30, off above 0.42) and a frame of debounce each
     way, so a pinch that flickers at the threshold does not flicker the
     gesture. A hand that vanishes for a moment keeps its state for 160 ms —
     trackers drop single frames — and is released after that. */
  class PinchState {
    constructor(){ this.reset(); }
    reset(){ this.engaged = false; this.onRun = 0; this.offRun = 0; this.lastSeen = -1e9; this.last = null; }
    update(m, t){
      if(!m){
        if(t - this.lastSeen > 160){ this.engaged = false; this.onRun = 0; this.offRun = 0; this.last = null; }
        return this.engaged;
      }
      this.lastSeen = t;
      this.last = m;
      const notFist = m.indexReach > FIST_GUARD && m.thumbReach > FIST_GUARD;
      if(!this.engaged){
        this.onRun = (m.pinch < PINCH_ON && notFist) ? this.onRun + 1 : 0;
        if(this.onRun >= 2){ this.engaged = true; this.offRun = 0; }
      } else {
        this.offRun = (m.pinch > PINCH_OFF || !notFist) ? this.offRun + 1 : 0;
        if(this.offRun >= 2){ this.engaged = false; this.onRun = 0; }
      }
      return this.engaged;
    }
  }

  /* ------------------------------------------------------------------
     THE GESTURE (2.10.4: steps, not positions).

     Both hands pinched -> ARMING: ~150 ms of samples become the starting
     distance (their median, so one bad frame cannot set it). Nothing zooms.

     From there it is the MOVEMENT that zooms, not where the hands are:
     every centimetre or so the two pinches travel APART is one step in,
     every centimetre they travel TOGETHER is one step out, and hands held
     still — close together or far apart — do nothing at all. That is what
     he asked for, and it is also why it feels slow and exact: a step is a
     small, fixed amount of movement, counted one by one.

     Centimetres come from the hands themselves: distance is measured in
     palm lengths (wrist to the middle knuckle, about PALM_CM = 9 cm on an
     adult), so leaning toward the camera, which makes the hands AND the gap
     bigger together, is not a zoom. Sensitivity is steps per centimetre;
     the threshold is how many millimetres of movement are ignored at the
     start, before the first step — pinching itself moves the hands a
     little.

     Each frame reports `steps`, how many whole steps were crossed since the
     last frame (+ in, - out), and `level`, the total for this gesture.
     Either hand letting go ends it at once; the next pinch starts again
     from wherever the hands are.
  ------------------------------------------------------------------ */
  const PALM_CM = 9, ARM_MS = 150;

  class TwoHandZoom {
    constructor(settings){
      this.pins = [new PinchState(), new PinchState()];
      this.slots = [null, null];          // last pinch point per slot, to keep hands apart
      this.configure(settings);
      this.resetGesture();
    }
    configure(settings){
      this.s = normaliseSettings(settings);
      this.filter = new OneEuro(lerp(3.0, 0.5, this.s.smoothing), 0.08, 1.0);
    }
    /* Kept for callers from before 2.10.4; the limits now live in the
       manager, which knows the window's zoom level. */
    setLimits(){}
    stepSize(){ return (1 / PALM_CM) / this.s.sensitivity; }            // palm lengths per step
    deadZone(){ return (this.s.threshold / 10) / PALM_CM; }             // mm -> palm lengths
    resetGesture(){
      this.state = 'idle'; this.samples = []; this.baseline = null; this.armStart = 0;
      this.anchor = null; this.level = 0; this.lastD = null;
      if(this.filter) this.filter.reset();
    }

    /* Two hands to two slots: by x when both are seen, by nearness to the
       last known slot when one is — both by the palm centre (2.12.0), which
       does not jump when the fingers move. */
    assign(ms){
      const out = [null, null];
      const at = (m) => m.center || m.point;
      if(ms.length >= 2){
        const two = ms.slice(0, 2).sort((a, b) => at(a).x - at(b).x);
        out[0] = two[0]; out[1] = two[1];
      } else if(ms.length === 1){
        const m = ms[0];
        const d0 = this.slots[0] ? dist(at(m), this.slots[0]) : Infinity;
        const d1 = this.slots[1] ? dist(at(m), this.slots[1]) : Infinity;
        out[d0 <= d1 ? 0 : 1] = m;
      }
      for(let i = 0; i < 2; i++) if(out[i]){ this.slots[i] = at(out[i]); out[i].slot = i; }
      return out;
    }

    /* frame = { t (ms), hands: [{ landmarks }], width, height }.
       Returns what happened: { type: 'none'|'start'|'move'|'end'|'cancel', steps, level, ... } */
    update(frame){
      const t = frame.t;
      const ms = (frame.hands || []).map(h => handMetrics(h.landmarks || h, frame.width, frame.height)).filter(Boolean);
      const slot = this.assign(ms);
      this.lastMetrics = ms;
      const e0 = this.pins[0].update(slot[0], t), e1 = this.pins[1].update(slot[1], t);
      const a = this.pins[0].last, b = this.pins[1].last;
      const both = e0 && e1 && a && b;
      const base = { state: this.state, points: [a && a.point, b && b.point], engaged: [e0, e1], steps: 0, level: this.level };

      if(!both){
        if(this.state === 'armed' || this.state === 'zooming'){
          const ev = Object.assign(base, { type: 'end', level: this.level });
          this.resetGesture();
          ev.state = 'idle';
          return ev;
        }
        const was = this.state;
        if(was === 'arming') this.resetGesture();
        return Object.assign(base, { type: was === 'arming' ? 'cancel' : 'none', state: 'idle' });
      }

      const D = dist(a.point, b.point) / ((a.scale + b.scale) / 2);
      const Ds = this.filter.filter(D, t);
      this.lastD = Ds;

      if(this.state === 'idle'){
        this.resetGesture();
        this.filter.filter(D, t);
        this.state = 'arming'; this.armStart = t; this.samples = [D];
        return Object.assign(base, { type: 'none', state: 'arming', distance: D });
      }
      if(this.state === 'arming'){
        this.samples.push(Ds);
        if(t - this.armStart >= ARM_MS && this.samples.length >= 3){
          this.baseline = median(this.samples);
          this.state = 'armed';
          return Object.assign(base, { type: 'start', state: 'armed', baseline: this.baseline, distance: Ds });
        }
        return Object.assign(base, { type: 'none', state: 'arming', distance: Ds });
      }

      /* armed: the first few millimetres are ignored; the steps are counted
         from where they end, so crossing them never jumps. */
      if(this.anchor === null){
        const dz = this.deadZone();
        if(Math.abs(Ds - this.baseline) <= dz){
          return Object.assign(base, { type: 'move', state: 'armed', baseline: this.baseline, distance: Ds });
        }
        this.anchor = this.baseline + Math.sign(Ds - this.baseline) * dz;
      }
      /* zooming: whole steps of movement since the last one, either way.
         The anchor moves by exactly one step each time, so a hand that
         trembles around a step's edge cannot tick in and out: going back
         takes a whole step of real movement. */
      const step = this.stepSize();
      let steps = 0;
      while(Ds - this.anchor >= step){ this.anchor += step; steps++; }
      while(this.anchor - Ds >= step){ this.anchor -= step; steps--; }
      this.level += steps;
      /* "zooming" from the first real step — the tracker's own tremble past
         the threshold is not a zoom, and the overlay should not say it is. */
      if(steps) this.state = 'zooming';
      return Object.assign(base, { type: 'move', state: this.state, baseline: this.baseline, distance: Ds,
                                   cm: (Ds - this.baseline) * PALM_CM, steps, level: this.level });
    }
  }

  /* ------------------------------------------------------------------
     PRECISE CONTROL (2.12.0) — one pinch turns a 3D model.

     Exactly ONE hand pinched (the other open, or not in view), held for
     TURN_ARM_MS, and nothing turns yet: the first TURN_DEAD_MM of movement
     are ignored, as pinching moves the hand. From there the palm centre is
     the handle, and the turn is measured ON THE SCREEN (2.13.1): crossing
     turnScreen of the picture (3/4 by default) is one full turn, 360°,
     however near or far the hand is — across, 3/4 of the width; up and
     down, 3/4 of the height. So the nearer the hand is to the camera, the
     less it has to move for the same turn. Right is right, up is up, and
     every direction between, all the way round. Mirror-proof: right means HIS right, which on the
     raw camera picture is to the left.

     Living beside the zoom:
       - two pinches are always a zoom: a second pinch ends the turn;
       - TURN_ARM_MS is longer than the gap between two hands closing when
         he starts a zoom, and the dead zone covers the moment before;
       - after a zoom (LATCH), the hand still pinched does not start
         turning when the other lets go — both must open first.
     A tracking glitch that throws the hand across the picture in one frame
     is not a movement; the turn starts again from wherever the hand is.
  ------------------------------------------------------------------ */
  const TURN_ARM_MS = 220, TURN_DEAD_MM = 4, TURN_JUMP = 2.5, TURN_MAX_FRAME = 90, TURN_GRACE_MS = 150;

  /* ------------------------------------------------------------------
     ONE FINGER IS THE MOUSE (2.16.0 in the Agent Atlas; since 2.17.0
     everywhere on the computer; since 2.18.0 by the ANGLE of the finger).

     The pose: the index straight (bent under POINT_ARM_DEG) and the other
     three folded (under FINGER_FOLDED) — "pointing". Held POINT_ARM_MS (a
     quarter of a second, so a passing gesture while he talks does not take
     the mouse) and the fingertip moves the pointer: the middle of the
     picture (POINTER_BOX, mirrored, so his right is right) spans the whole
     monitor, so he never has to reach the picture's edge.

     What the finger does is read as its BEND, in degrees from HIS OWN
     straight (the middle of what it read while he held it up to start, and
     followed while he points — a hand turned toward the camera reads a
     little differently, and that is not a bend):
       fully straight (within STRAIGHT_DEG)  the pointer follows the finger;
       between that and CLICK_DEG            nothing at all — the pointer
                                             stays where it was;
       bent CLICK_DEG (45°) or more          one left click, there.
     Then nothing until the finger is fully straight again, and the next
     bend is the next click. So there is no "how far is a click": straight
     moves, half-way rests, 45° clicks. Leaving straight takes LEAVE_FRAMES
     frames (one noisy frame is not a bend), and the pointer goes back to
     where the finger was straightest a moment ago — a bending finger's
     tip drifts before the bend shows, and the click goes where he pointed.
     A hand closing into a pinch (thumb out, its tip near the index tip) is
     not clicking: that bend is the pinch on its way.

     Once pointing, the other three only have to stay curled (under
     OTHERS_OPEN), not tightly folded: a hand that relaxes a little while it
     moves is still pointing. The pose lost (hand gone, fingers opened) for
     POINT_LOST_MS: the pointer lets go.

     ONE GESTURE AT A TIME (2.18.0): the pointer is told by HandGestures
     when a pinch is on (blocked: it neither moves nor clicks, and never
     starts) and when the zoom or the pinch's turn / scroll has really begun
     (takeover: it lets go). See HandGestures.update.

     The filter: One Euro at 1 Hz at rest, opening fast with speed and with
     a quick read of that speed (3 Hz). The old 0.4 Hz / 1 Hz trailed a
     slow, careful move and was slow to notice a move starting — the
     pointer stuck, then caught up. Measured (filtersweep): the first 8 px
     of a slow move a quarter sooner, 40% less lag while moving, and a
     still finger still wanders under 4 px of a 1920 x 1080 screen.
  ------------------------------------------------------------------ */
  const FINGER_STRAIGHT = 1.12, FINGER_FOLDED = 0.9, OTHERS_OPEN = 1.0,
        POINT_ARM_DEG = 35, STRAIGHT_DEG = 15, CLICK_DEG = 45,
        POINT_ARM_MS = 250, FOLD_FRAMES = 2, CLICK_REARM = 2, LEAVE_FRAMES = 2,
        POINT_LOST_MS = 300, POINTER_BOX = { x0: 0.2, y0: 0.12, w: 0.6, h: 0.6 },
        POINTER_FILTER = [1.0, 30, 3], POINTER_VEL_ALPHA = 0.8,
        JUMP_GATE = 0.05, JUMP_SPEED = 1.5, JUMP_ACCEPT = 3, JUMP_SAME = 0.06,
        POSE_GRACE_FRAMES = 3, STUCK_DEG = 30, STUCK_REARM_MS = 1800;
  const othersFolded = (m, limit) => !!(m && m.fingers && m.fingers.middle < limit &&
    m.fingers.ring < limit && m.fingers.pinky < limit);
  const isPointing = (m) => !!(m && m.bends && m.bends.index <= POINT_ARM_DEG && othersFolded(m, FINGER_FOLDED));
  const closingToPinch = (m) => m.pinch < PINCH_OFF && m.indexReach > FIST_GUARD && m.thumbReach > FIST_GUARD;

  class PointerTracker {
    constructor(){ this.fx = new OneEuro(...POINTER_FILTER); this.fy = new OneEuro(...POINTER_FILTER); this.reset(); }
    reset(){
      this.state = 'idle'; this.slot = -1; this.at = null; this.since = null; this.armBends = [];
      this.base = 0; this.bend = 0; this.out = 0; this.inRun = 0; this.clickRun = 0;
      this.lostAt = null; this.pos = null; this.hist = [];
      this.vel = { x: 0, y: 0 }; this.accT = null; this.cand = null; this.jumpRun = 0; this.poseBad = 0; this.restSince = null;
      this.fx.reset(); this.fy.reset();
    }
    /* The fingertip, in the window: x, y from 0 to 1. */
    static toWindow(tip, width, height){
      const mx = 1 - tip.x / width, my = tip.y / height;            // mirrored: his right is right
      return { x: clamp((mx - POINTER_BOX.x0) / POINTER_BOX.w, 0, 1), y: clamp((my - POINTER_BOX.y0) / POINTER_BOX.h, 0, 1) };
    }
    /* The fingertip becomes the pointer's place (and its speed). False when
       the tracker's answer is not believed: a fingertip that lands further
       from where the pointer was going than any hand moves (JUMP_GATE, and
       JUMP_SPEED windows a second for the time since the last answer we
       believed) is the tracker latching onto something else for a frame or
       two — a face, a dropped hand found again in the wrong place. It is
       ignored, and believed only when JUMP_ACCEPT answers in a row agree
       with each other (then the hand really is there: the pointer flies
       over, Rust slews it, never a teleport). */
    follow(m, t, width, height){
      const raw = PointerTracker.toWindow(m.pts[8], width, height);
      if(this.pos && this.accT !== null){
        const dt = Math.max(0, (t - this.accT) / 1000);
        const lead = Math.min(dt, 0.15);
        const px = this.pos.x + this.vel.x * lead, py = this.pos.y + this.vel.y * lead;
        if(Math.hypot(raw.x - px, raw.y - py) > JUMP_GATE + JUMP_SPEED * dt){
          this.jumpRun = this.cand && Math.hypot(raw.x - this.cand.x, raw.y - this.cand.y) < JUMP_SAME ? this.jumpRun + 1 : 1;
          this.cand = raw;
          if(this.jumpRun < JUMP_ACCEPT) return false;
          this.fx.reset(); this.fy.reset(); this.pos = null; this.vel = { x: 0, y: 0 };    // believed: start again from here
        }
        this.jumpRun = 0; this.cand = null;
      }
      const prev = this.pos, dtp = this.accT === null ? 0 : (t - this.accT) / 1000;
      this.pos = { x: this.fx.filter(raw.x, t), y: this.fy.filter(raw.y, t) };
      if(prev && dtp > 0.001){
        this.vel = { x: this.vel.x + ((this.pos.x - prev.x) / dtp - this.vel.x) * POINTER_VEL_ALPHA,
                     y: this.vel.y + ((this.pos.y - prev.y) / dtp - this.vel.y) * POINTER_VEL_ALPHA };
      }
      this.accT = t;
      this.hist.push({ t, b: this.bend, x: this.pos.x, y: this.pos.y });
      while(this.hist.length > 1 && t - this.hist[0].t > 300) this.hist.shift();
      return true;
    }
    straightAgain(){ this.state = 'pointing'; this.out = 0; this.inRun = 0; this.hist = []; this.restSince = null; this.fx.reset(); this.fy.reset(); this.vel = { x: 0, y: 0 }; this.accT = null; }
    /* gate: { blocked: a pinch is on, takeover: the zoom or a turn/scroll has begun } */
    update(t, ms, engaged, width, height, gate){
      const out = (type, extra) => Object.assign({ type, state: this.state, bend: this.bend,
        x: this.pos ? this.pos.x : null, y: this.pos ? this.pos.y : null, vx: this.vel.x, vy: this.vel.y }, extra || {});
      /* The pointer stands still where it is (the cursor must not coast on). */
      const stop = () => { this.vel = { x: 0, y: 0 }; };
      gate = gate || {};
      ms = ms || [];
      if(gate.takeover){
        if(this.state === 'idle'){ this.since = null; this.armBends = []; return out('none'); }
        this.reset(); return out('end');
      }
      /* Its own hand is the one nearest where it was (slot numbers change
         when a second hand comes into view: they go left to right). */
      let m = null;
      if(this.state !== 'idle' && this.at){
        let bd = Infinity;
        for(const x of ms){ const dd = Math.hypot(x.center.x - this.at.x, x.center.y - this.at.y) / x.scale; if(dd < bd){ bd = dd; m = x; } }
        if(bd > 1.5) m = null;
      }
      if(m){ this.at = m.center; this.slot = m.slot; }
      if(gate.blocked){
        if(this.state === 'idle'){ this.since = null; this.armBends = []; return out('none'); }
        /* Paused. If the pinch lets go before its turn begins, the index is
           still opening out of it, bent: nothing until it is fully
           straight again, as after a click — never a stray click. The
           first frame says "stop here" (a freeze, speed nil) so the cursor
           does not coast on into the pinch. */
        const first = this.state !== 'paused';
        this.state = 'paused'; this.out = 0; this.inRun = 0; this.clickRun = 0; this.restSince = null;
        stop();
        return first ? out('freeze', { paused: true }) : out('hold', { paused: true });
      }
      if(this.state === 'idle'){
        m = ms.find(isPointing);
        if(!m){ this.since = null; this.armBends = []; return out('none'); }
        if(this.since === null){ this.since = t; this.armBends = []; }
        this.armBends.push(m.bends.index);
        if(t - this.since < POINT_ARM_MS) return out('none');
        this.base = clamp(median(this.armBends), 0, POINT_ARM_DEG);
        this.state = 'pointing'; this.slot = m.slot; this.at = m.center; this.fx.reset(); this.fy.reset();
        this.bend = Math.max(0, m.bends.index - this.base); this.hist = []; this.poseBad = 0;
        this.follow(m, t, width, height);
        return out('start');
      }
      if(!m || !m.bends || !othersFolded(m, OTHERS_OPEN)){
        /* The hand is tracked but the pose read wrong for a frame or two
           (the other fingers' ratio flickers as the hand turns): carry on
           following the fingertip, for POSE_GRACE_FRAMES, while the index
           is still straight. Anything longer is a lost pose. */
        if(m && m.bends && this.state === 'pointing' && ++this.poseBad <= POSE_GRACE_FRAMES && m.bends.index - this.base <= STRAIGHT_DEG){
          this.bend = Math.max(0, m.bends.index - this.base);
          return this.follow(m, t, width, height) ? out('move') : out('hold', { rejected: true });
        }
        if(this.lostAt === null) this.lostAt = t;
        if(t - this.lostAt > POINT_LOST_MS){ this.reset(); return out('end'); }
        return out('hold');
      }
      this.lostAt = null; this.poseBad = 0;
      const raw = m.bends.index;
      if(this.state !== 'pointing' && raw < this.base) this.base = clamp(this.base + (raw - this.base) * 0.1, 0, POINT_ARM_DEG);
      const b = this.bend = Math.max(0, raw - this.base);
      const straight = b <= STRAIGHT_DEG;
      this.clickRun = b >= CLICK_DEG ? this.clickRun + 1 : 0;
      const click = () => { this.state = 'clicked'; this.inRun = 0; stop(); return out('click'); };
      if(this.state === 'pointing'){
        if(straight){
          this.out = 0;
          /* His straight drifts as the hand turns: follow it, down quickly, up slowly. */
          this.base = clamp(this.base + (raw - this.base) * (raw < this.base ? 0.1 : 0.02), 0, POINT_ARM_DEG);
          return this.follow(m, t, width, height) ? out('move') : out('hold', { rejected: true });
        }
        this.out++;
        if(this.out < LEAVE_FRAMES && this.clickRun < FOLD_FRAMES) return out('hold');
        /* Bent: back to where the finger was straightest a moment ago. */
        const best = this.hist.reduce((a, h) => (h.b < a.b ? h : a), this.hist[this.hist.length - 1] || { b: 0, x: this.pos.x, y: this.pos.y });
        this.pos = { x: best.x, y: best.y };
        this.state = 'folding'; this.inRun = 0; this.restSince = null;
        stop();
        if(this.clickRun >= FOLD_FRAMES && !closingToPinch(m)) return click();
        return out('freeze');
      }
      /* Not following: waiting for a click, or for the finger to straighten.
         A finger that stays under STUCK_DEG for STUCK_REARM_MS (his straight
         moved, or the angle read high for good) is straight enough: from
         there it follows again, rather than staying frozen for ever. */
      if(b <= STUCK_DEG){
        if(this.restSince === null) this.restSince = t;
        else if(t - this.restSince >= STUCK_REARM_MS){ this.base = clamp(raw, 0, POINT_ARM_DEG); this.straightAgain(); return out('hold'); }
      } else this.restSince = null;
      if(this.state === 'folding'){
        if(straight){
          if(++this.inRun >= CLICK_REARM) this.straightAgain();
          return out('hold');
        }
        this.inRun = 0;
        if(this.clickRun >= FOLD_FRAMES && !closingToPinch(m)) return click();
        return out('hold');
      }
      /* clicked (or paused by a pinch): nothing until the finger is fully straight again. */
      this.inRun = straight ? this.inRun + 1 : 0;
      if(this.inRun >= CLICK_REARM) this.straightAgain();
      return out('hold');
    }
  }

  class HandGestures {
    constructor(settings){
      this.zoom = new TwoHandZoom(settings);
      this.pointer = new PointerTracker();
      this.latch = false;
      this.configure(settings);
      this.resetTurn();
    }
    configure(settings){
      this.s = normaliseSettings(settings);
      this.zoom.configure(settings);
      const mc = lerp(2.5, 0.6, this.s.smoothing);
      this.fx = new OneEuro(mc, 1.2, 1.0);
      this.fy = new OneEuro(mc, 1.2, 1.0);
    }
    /* The zoom's state, as before: callers and tests read gesture.state. */
    get state(){ return this.zoom.state; }
    get pins(){ return this.zoom.pins; }
    setLimits(){}
    resetGesture(){ this.zoom.resetGesture(); this.resetTurn(); this.pointer.reset(); this.latch = false; }
    resetTurn(){
      this.turn = { state: 'idle', slot: -1, armStart: 0, scale: 0, origin: null, last: null,
                    prevRaw: null, originPx: null, openAt: null, total: { x: 0, y: 0 } };
      if(this.fx){ this.fx.reset(); this.fy.reset(); }
    }

    update(frame){
      const ev = this.zoom.update(frame);
      ev.hands = (this.zoom.lastMetrics || []).map(m => ({ pts: m.pts, center: m.center, slot: m.slot }));
      const e = ev.engaged || [false, false];
      /* Only two hands really in view make a zoom (2.16.0): one hand that
         changed slot keeps its old slot's pinch for a moment, and that
         alone used to set the latch and lock the one-hand gesture out. */
      if(e[0] && e[1] && (this.zoom.lastMetrics || []).length >= 2) this.latch = true;
      if(!e[0] && !e[1]) this.latch = false;
      ev.turn = this.turnStep(frame.t, e, frame.width, frame.height);
      /* ONE GESTURE AT A TIME (2.18.0). A pinch on either hand — the
         pointing hand's own as well — stops the finger mouse dead: no move,
         no click, and it never starts while a pinch is on. Once the zoom
         or the pinch's turn / scroll has really begun, the pointer lets
         go. Before, the pointing hand's own pinch was taken for its click
         and ignored, so it scrolled with the mouse still held. */
      const turning = ev.turn.state === 'armed' || ev.turn.state === 'turning';
      const gate = { blocked: !!(e[0] || e[1]), takeover: this.zoom.state !== 'idle' || turning };
      if(this.s.pointerEnabled) ev.pointer = this.pointer.update(frame.t, this.zoom.lastMetrics, e, frame.width, frame.height, gate);
      else if(this.pointer.state !== 'idle'){ this.pointer.reset(); ev.pointer = { type: 'end', state: 'idle' }; }   // switched off mid-point
      else ev.pointer = { type: 'none', state: 'idle' };
      ev.active = this.zoom.state !== 'idle' ? 'zoom' : turning ? 'turn' : this.pointer.state !== 'idle' ? 'pointer' : null;
      ev.latched = this.latch;
      return ev;
    }

    endTurn(){
      const T = this.turn, was = T.state, total = { x: T.total.x, y: T.total.y };
      this.resetTurn();
      return { type: (was === 'armed' || was === 'turning') ? 'end' : was === 'arming' ? 'cancel' : 'none',
               state: 'idle', dx: 0, dy: 0, total };
    }

    turnStep(t, e, width, height){
      const single = !!e[0] !== !!e[1];
      /* A pinch that opens for a moment mid-turn — a fast hand blurs and
         the tracker reads it open for two frames — is not the end: the
         turn waits TURN_GRACE_MS for it and carries on from wherever the
         hand is when it closes (nothing moves meanwhile, and the gap's
         movement is not counted, so letting go to move back and pinching
         again still works as a clutch). It used to end, re-arm (220 ms)
         and cross the dead zone again: the scroll stalled. A second pinch
         is still the zoom at once. */
      const W0 = this.turn;
      if(!e[0] && !e[1] && this.s.turnEnabled && !this.latch && (W0.state === 'armed' || W0.state === 'turning')){
        if(W0.openAt == null) W0.openAt = t;
        if(t - W0.openAt < TURN_GRACE_MS)
          return { type: 'move', state: W0.state, slot: W0.slot, center: W0.prevRaw, origin: W0.originPx, dx: 0, dy: 0, waiting: true,
                   total: { x: W0.total.x, y: W0.total.y } };
      }
      if(!this.s.turnEnabled || !single || this.latch) return this.endTurn();
      const slot = e[0] ? 0 : 1;
      const m = this.zoom.pins[slot].last;
      if(!m || !m.center) return this.endTurn();
      let T = this.turn;
      if(T.state !== 'idle' && T.slot !== slot){ const ended = this.endTurn(); if(ended.type === 'end') return ended; T = this.turn; }
      const raw = m.center;
      const view = (extra) => Object.assign({ state: T.state, slot, center: raw, origin: T.originPx, dx: 0, dy: 0,
                                              total: { x: T.total.x, y: T.total.y } }, extra || {});
      if(T.openAt != null){
        /* Closed again within the grace: on from here. */
        T.openAt = null; T.prevRaw = raw; this.fx.reset(); this.fy.reset();
        const x0 = this.fx.filter(raw.x / T.scale, t), y0 = this.fy.filter(raw.y / T.scale, t);
        T.last = { x: x0, y: y0 };
        if(T.state === 'armed'){ T.origin = { x: x0, y: y0 }; T.originPx = raw; }
        return view({ type: 'move' });
      }
      if(T.state === 'idle'){
        T.state = 'arming'; T.slot = slot; T.armStart = t; T.scale = m.scale;
        return view({ type: 'none' });
      }
      if(T.state === 'arming'){
        T.scale = T.scale * 0.7 + m.scale * 0.3;
        if(t - T.armStart < TURN_ARM_MS) return view({ type: 'none' });
        const x = this.fx.filter(raw.x / T.scale, t), y = this.fy.filter(raw.y / T.scale, t);
        T.state = 'armed'; T.origin = { x, y }; T.last = { x, y }; T.prevRaw = raw; T.originPx = raw;
        return view({ type: 'start', origin: raw });
      }
      /* A jump of several palms in one frame is the tracker losing the
         hand, not the hand moving: start again from where it is now. */
      if(T.prevRaw && Math.hypot(raw.x - T.prevRaw.x, raw.y - T.prevRaw.y) / T.scale > TURN_JUMP){
        T.prevRaw = raw; this.fx.reset(); this.fy.reset();
        const x0 = this.fx.filter(raw.x / T.scale, t), y0 = this.fy.filter(raw.y / T.scale, t);
        T.last = { x: x0, y: y0 };
        if(T.state === 'armed'){ T.origin = { x: x0, y: y0 }; T.originPx = raw; }
        return view({ type: 'move', glitch: true });
      }
      T.prevRaw = raw;
      const x = this.fx.filter(raw.x / T.scale, t), y = this.fy.filter(raw.y / T.scale, t);
      if(T.state === 'armed'){
        const mm = Math.hypot(x - T.origin.x, y - T.origin.y) * PALM_CM * 10;
        if(mm < TURN_DEAD_MM) return view({ type: 'move' });
        T.state = 'turning'; T.last = { x, y };
        return view({ type: 'move' });
      }
      /* x and y are in palms of T.scale pixels (filtered there, so the
         smoothing is the same whatever the camera's size); times T.scale
         they are pixels again, over the picture's width or height the
         share of the screen crossed. */
      const per = 360 / this.s.turnScreen;
      const W = width > 0 ? width : 1280, H = height > 0 ? height : 720;
      const dx = clamp(-(x - T.last.x) * T.scale / W * per, -TURN_MAX_FRAME, TURN_MAX_FRAME);
      const dy = clamp(-(y - T.last.y) * T.scale / H * per, -TURN_MAX_FRAME, TURN_MAX_FRAME);
      T.last = { x, y };
      T.total.x += dx; T.total.y += dy;
      return view({ type: 'move', dx, dy });
    }
  }

  /* ------------------------------------------------------------------
     THE FIST BUMP (2.31.0) — minimise.

     Both hands closed into fists and held APART, then brought together
     until the knuckles touch: the window he is working in is minimised,
     as its own minimise button would (Rust's minimize_window). It goes to
     the taskbar and stays open.

     A fist: at least three of the four fingers folded (straightness under
     FINGER_FOLDED, or bent past BUMP_BEND_DEG). Distances are between the
     palm centres, in palm lengths, so how far he sits from the camera does
     not matter. APART is more than BUMP_APART palms (about 23 cm) for a few
     frames; TOUCHING is under BUMP_TOUCH (about 14 cm: two fists side by
     side are about one fist apart, centre to centre), reached within
     BUMP_WINDOW_MS of last being apart, so two fists that drift together
     slowly, or are simply held close, do nothing. Fists pressed together
     often merge into one hand for the tracker: losing one of them while
     they were already within BUMP_NEAR of each other, the other still a
     fist, counts as the touch too.

     Once it fires it is spent until the hands are apart again or stop
     being fists, and never twice within BUMP_COOL_MS, so one bump is one
     window put away.
  ------------------------------------------------------------------ */
  const BUMP_APART = 2.5, BUMP_TOUCH = 1.5, BUMP_NEAR = 1.9, BUMP_WINDOW_MS = 1500,
        BUMP_APART_FRAMES = 3, BUMP_BEND_DEG = 100, BUMP_LOST_MS = 400, BUMP_COOL_MS = 1500;
  const isFist = (m) => {
    if(!m || !m.fingers) return false;
    let folded = 0;
    for(const f of ['index', 'middle', 'ring', 'pinky']){
      if(m.fingers[f] < FINGER_FOLDED || (m.bends && m.bends[f] > BUMP_BEND_DEG)) folded++;
    }
    return folded >= 3;
  };

  class FistBump {
    constructor(){ this.reset(); this.firedAt = -1e9; }
    reset(){ this.state = 'idle'; this.apartRun = 0; this.apartAt = -1e9; this.lastTwoAt = -1e9; this.lastD = null; }
    /* ms: this frame's handMetrics. Returns { type: 'bump', distance } on the
       frame it fires, otherwise { type: 'none', state, distance }. */
    update(t, ms){
      const hands = (ms || []).filter(Boolean);
      const fists = hands.filter(isFist);
      const none = (extra) => Object.assign({ type: 'none', state: this.state, distance: this.lastD }, extra || {});
      if(hands.length >= 2 && fists.length >= 2){
        const a = fists[0], b = fists[1];
        const D = dist(a.center, b.center) / ((a.scale + b.scale) / 2);
        this.lastTwoAt = t; this.lastD = D;
        if(this.state === 'spent'){
          if(D > BUMP_APART) { this.state = 'idle'; this.apartRun = 0; }
          return none();
        }
        if(D > BUMP_APART){
          this.apartRun++;
          if(this.apartRun >= BUMP_APART_FRAMES){ this.state = 'apart'; this.apartAt = t; }
          return none();
        }
        this.apartRun = 0;
        if(this.state === 'apart'){
          if(t - this.apartAt > BUMP_WINDOW_MS){ this.state = 'idle'; return none(); }
          if(D < BUMP_TOUCH) return this.fire(t, D);
        }
        return none();
      }
      /* One fist left, right after two were closing in: they merged. */
      if(this.state === 'apart' && hands.length === 1 && fists.length === 1 && this.lastD !== null &&
         this.lastD < BUMP_NEAR && t - this.lastTwoAt < BUMP_LOST_MS && t - this.apartAt <= BUMP_WINDOW_MS){
        return this.fire(t, this.lastD);
      }
      if(t - this.lastTwoAt > BUMP_LOST_MS){
        if(this.state !== 'idle') this.reset();
        this.apartRun = 0;
      }
      return none();
    }
    fire(t, D){
      if(t - this.firedAt < BUMP_COOL_MS){ this.state = 'spent'; return { type: 'none', state: 'spent', distance: D }; }
      this.firedAt = t;
      this.state = 'spent'; this.apartRun = 0;
      return { type: 'bump', state: 'spent', distance: D };
    }
  }

  /* From the turn to the model window: only when a 3D model is open. The
     viewer answers jarvis://model-ping with jarvis://model-pong (and says
     so by itself when a model loads, and model-gone when it closes); a
     pong in the last TURN_PRESENT_MS means there is a model to turn. Turns
     go out as degrees, + right and + up, on jarvis://model-rotate.

     Or to another program's 3D view (2.15.0): when the program in front is
     one that turns by a mouse drag — JARVIS Agent Atlas, setTarget from the
     foreground probe — the same degrees go to Rust's drag_send, which
     drags in that window. That program is in front, so it is what he is
     looking at, and it wins over a viewer open behind it. The window is
     fixed when the turn begins. Sends are one at a time and in order
     (start, moves, end), the moves that pile up behind a slow one merged
     into one; a hand held still sends a keep-alive every TURN_KEEP_MS, or
     Rust's watchdog would let go of the button under a held pinch.

     EVERYWHERE ELSE IT SCROLLS (2.16.0). With any other program in front
     (kind 'scroll' from the probe — not JARVIS's 3D viewer, not the Atlas,
     not a 3D program whose wheel is its zoom) the same pinch grabs the
     page: the page follows the hand, as on a touch screen. Hand down, the
     page comes down (it scrolls UP); hand up, it scrolls down; hand to his
     right, it scrolls left; to his left, right. Degrees become wheel units
     (SCROLL_UNITS_PER_DEG x scrollSpeed: a quarter of the picture is four
     notches), fractions carried over, sent by Rust's scroll_send as the
     vertical and horizontal wheel. A JARVIS viewer open BEHIND that
     program no longer takes the pinch: what is in front is what he is
     working in. */
  const TURN_PRESENT_MS = 6000, TURN_KEEP_MS = 400, SCROLL_UNITS_PER_DEG = 4;
  class TurnRelay {
    constructor(o){
      o = o || {};
      this.emit = o.emit || (() => {});
      this.invoke = o.invoke || null;
      this.now = o.now || (() => Date.now());
      this.onStatus = o.onStatus || (() => {});
      this.speed = o.speed || (() => 1);
      this.lastPong = -1e9; this.loaded = false;
      this.target = null; this.drag = null; this.scroll = null; this.busy = false;
      this.reset();
    }
    reset(){ this.sentStart = false; this.pinged = false; this.armedShown = false; this.mode = null; }
    pong(p){ this.lastPong = this.now(); this.loaded = !(p && p.loaded === false); }
    gone(){ this.lastPong = -1e9; this.loaded = false; }
    /* The program in front, from the probe: { hwnd, name, kind, aim } with
       kind 'drag' (turns by a drag: the Atlas), 'scroll' (anything else
       the wheel reaches), 'viewer' (JARVIS's own 3D window); or null. */
    setTarget(t){
      const kind = t && (t.kind || 'drag');
      this.target = (t && t.hwnd && (kind === 'viewer' || this.invoke))
        ? { hwnd: t.hwnd, name: t.name || 'the 3D view', aim: t.aim || null, kind } : null;
    }
    viewerOpen(){ return this.loaded && this.now() - this.lastPong < TURN_PRESENT_MS; }
    /* Where a turn starting now would go. */
    route(){
      const t = this.target;
      if(t && (t.kind === 'drag' || t.kind === 'scroll')) return t.kind;
      return this.viewerOpen() ? 'viewer' : null;
    }
    present(){ return !!this.route(); }
    ping(){ try{ this.emit('jarvis://model-ping', {}); }catch(e){} }
    handle(turn){
      if(!turn) return;
      if(turn.state === 'arming' && !this.pinged){ this.pinged = true; this.ping(); }
      if(turn.type === 'start'){
        this.armedShown = true;
        const r = this.route();
        this.onStatus(r ? { kind: 'turn-ready', mode: r, name: r === 'viewer' ? null : this.target.name } : { kind: 'turn-none' });
        return;
      }
      if(turn.type === 'move' && (turn.dx || turn.dy)){
        if(!this.mode){
          const r = this.route();
          if(r === 'drag'){ this.mode = 'drag'; this.drag = { hwnd: this.target.hwnd, name: this.target.name, aim: this.target.aim, started: false,
                                                               pdx: 0, pdy: 0, keep: false, keptAt: this.now(), ending: false }; }
          else if(r === 'scroll'){ this.mode = 'scroll'; this.scroll = { hwnd: this.target.hwnd, name: this.target.name, h: 0, v: 0, total: { h: 0, v: 0 } }; }
          else if(r === 'viewer') this.mode = 'viewer';
          else return;
        }
        if(this.mode === 'failed') return;
        if(this.mode === 'scroll'){
          const s = this.scroll, k = SCROLL_UNITS_PER_DEG * (Number(this.speed()) || 1);
          if(!s) return;
          /* The page follows the hand: hand up (+dy) scrolls down (wheel -),
             hand to his right (+dx) scrolls left (horizontal wheel -). */
          s.h += -turn.dx * k; s.v += -turn.dy * k;
          this.pumpScroll();
          this.onStatus({ kind: 'turn', mode: 'scroll', total: turn.total, name: s.name });
          return;
        }
        if(this.mode === 'drag'){
          const d = this.drag;
          if(!d) return;
          d.pdx += turn.dx; d.pdy += turn.dy; d.keptAt = this.now();
          this.pump();
          this.onStatus({ kind: 'turn', total: turn.total, name: d.name });
          return;
        }
        if(!this.sentStart){ this.sentStart = true; this.emit('jarvis://model-rotate', { phase: 'start' }); }
        this.emit('jarvis://model-rotate', { phase: 'move', dx: turn.dx, dy: turn.dy });
        this.onStatus({ kind: 'turn', total: turn.total });
        return;
      }
      if(turn.type === 'move' && this.mode === 'drag' && this.drag && this.now() - this.drag.keptAt >= TURN_KEEP_MS){
        this.drag.keep = true; this.drag.keptAt = this.now();
        this.pump();
        return;
      }
      if(turn.type === 'end' || turn.type === 'cancel'){
        if(this.mode === 'viewer' && this.sentStart) this.emit('jarvis://model-rotate', { phase: 'end' });
        if(this.mode === 'scroll') this.scroll = null;
        if(this.mode === 'drag' && this.drag){ this.drag.ending = true; this.pump(); }
        if(this.armedShown || this.mode) this.onStatus({ kind: 'turn-idle' });
        this.reset();
      }
    }
    /* One call to drag_send at a time, in order. */
    pump(){
      const d = this.drag;
      if(this.busy || !d) return;
      let job = null;
      if(!d.started) job = { phase: 'start', dx: 0, dy: 0 };
      else if(d.pdx || d.pdy || d.keep){ job = { phase: 'move', dx: d.pdx, dy: d.pdy }; d.pdx = 0; d.pdy = 0; d.keep = false; }
      else if(d.ending) job = { phase: 'end', dx: 0, dy: 0 };
      if(!job) return;
      this.busy = true;
      Promise.resolve()
        .then(() => this.invoke('drag_send', job.phase === 'start' && d.aim
          ? { hwnd: d.hwnd, phase: 'start', dx: 0, dy: 0, aim: d.aim }
          : { hwnd: d.hwnd, phase: job.phase, dx: job.dx, dy: job.dy }))
        .then(() => {
          if(job.phase === 'start') d.started = true;
          if(job.phase === 'end' && this.drag === d) this.drag = null;
        }, (err) => {
          /* Rust has already let go of the button (or never pressed it).
             Nothing more goes to that window for this turn. */
          if(this.drag === d) this.drag = null;
          if(this.mode === 'drag') this.mode = 'failed';
          this.onStatus({ kind: 'turn-failed', reason: String((err && err.message) || err), name: d.name });
        })
        .then(() => { this.busy = false; this.pump(); this.pumpScroll(); });
    }
    /* Whole wheel units only; what is left over waits for the next move. */
    pumpScroll(){
      const s = this.scroll;
      if(this.busy || !s) return;
      const h = Math.trunc(s.h), v = Math.trunc(s.v);
      if(!h && !v) return;
      s.h -= h; s.v -= v; s.total.h += h; s.total.v += v;
      this.busy = true;
      Promise.resolve()
        .then(() => this.invoke('scroll_send', { hwnd: s.hwnd, h, v }))
        .then(() => {}, (err) => {
          if(this.scroll === s) this.scroll = null;
          if(this.mode === 'scroll') this.mode = 'failed';
          this.onStatus({ kind: 'turn-failed', reason: String((err && err.message) || err), name: s.name });
        })
        .then(() => { this.busy = false; this.pump(); this.pumpScroll(); });
    }
  }

  /* The finger's pointer, to Rust's pointer_send: "start" picks the monitor
     the pointer is on, then x, y (fractions of that monitor) move the real
     pointer, "click" is the left button there, "end" lets the monitor go.
     Everywhere, like a mouse: no window is asked first (2.17.0). One call
     at a time; moves that pile up are merged into the newest; a click is
     never dropped and goes in order. */
  class PointerRelay {
    constructor(o){
      o = o || {};
      this.invoke = o.invoke || null;
      this.onStatus = o.onStatus || (() => {});
      this.busy = false; this.queue = []; this.move = null; this.active = false; this.failed = false;
      this.lateMs = null;
    }
    /* How old the camera's pictures are when they reach us, measured by the
       controller from the frames' own capture stamps (null if the browser
       does not give them). Rust sets the cursor's lead from it. */
    setLate(ms){ this.lateMs = typeof ms === 'number' && isFinite(ms) && ms >= 0 ? Math.round(ms) : null; }
    handle(p){
      if(!p || p.type === 'none' || !this.invoke) return;
      if(p.type === 'end'){
        if(this.active){ this.onStatus({ kind: 'pointer-idle' }); this.queue.push({ phase: 'end' }); }
        this.active = false; this.failed = false; this.move = null;
        this.pump();
        return;
      }
      if(p.type === 'start'){
        this.active = true; this.failed = false;
        this.queue.push({ phase: 'start' });
        this.onStatus({ kind: 'pointer', name: 'the screen' });
      }
      if(!this.active || this.failed) return;
      if(p.type === 'click'){
        this.move = null; this.queue.push({ phase: 'click', x: p.x, y: p.y });
        this.onStatus({ kind: 'pointer-click' });
      } else if(p.x != null && (p.type === 'start' || p.type === 'move' || p.type === 'freeze')){
        /* vx, vy: how fast the finger is going (fractions of the monitor a
           second); Rust's glide keeps the cursor moving between samples. */
        this.move = { phase: 'move', x: p.x, y: p.y, vx: p.type === 'freeze' ? 0 : (p.vx || 0), vy: p.type === 'freeze' ? 0 : (p.vy || 0) };
        if(this.lateMs !== null) this.move.late = this.lateMs;
      }
      this.pump();
    }
    pump(){
      if(this.busy) return;
      let job = null;
      if(this.queue.length) job = this.queue.shift();
      else if(this.move){ job = this.move; this.move = null; }
      if(!job) return;
      this.busy = true;
      Promise.resolve()
        .then(() => this.invoke('pointer_send', job))
        .then(() => {}, (err) => {
          if(job.phase === 'end') return;
          this.failed = true; this.queue = this.queue.filter(q => q.phase === 'end'); this.move = null;
          this.onStatus({ kind: 'pointer-failed', reason: String((err && err.message) || err) });
        })
        .then(() => { this.busy = false; this.pump(); });
    }
  }

  /* ------------------------------------------------------------------
     ADAPTERS — how each kind of program is zoomed. Chosen from what Rust
     reports about the foreground window (its program and window class),
     never hard-coded to one application.

       ctrl_wheel   Ctrl + wheel at the pointer: browsers, PDF readers,
                    Office, image viewers, terminals, Explorer. It is also
                    exactly what Windows sends any program when you pinch a
                    precision touchpad, which is why it is the fallback.
       wheel        the plain wheel: 3D applications dolly the camera with
                    it — and in Blender Ctrl+wheel PANS, so it must not get
                    the generic treatment.
       alt_wheel    Photoshop, where Alt+wheel is zoom and Ctrl+wheel scrolls.
       ctrl_keys    Ctrl+= / Ctrl+-: Electron apps (VS Code, Slack, Discord),
                    which zoom from the keyboard and ignore Ctrl+wheel.
       direct       JARVIS's own 3D viewer: its camera distance, set exactly.

     step is roughly how much one wheel notch or keypress zooms, so the
     gesture can say how many to send; rate caps notches per second.
  ------------------------------------------------------------------ */
  const ADAPTERS = [
    /* His JARVIS Agent Atlas (2.15.0): a three.js map with OrbitControls.
       The plain wheel zooms it (each notch 1/0.95), a left drag turns it —
       so precise control reaches it too (turn: 'drag'). First, and matched
       by title as well, so the Atlas opened in a browser is still the
       Atlas. */
    /* aim: where in the window the wheel goes and the turn's drag takes
       hold, as x,y fractions, in the order Rust tries them. A label there
       swallows the press and the wheel, and the labels turn with the map,
       so no one place is always bare: Rust moves the pointer to each in
       turn and presses where the Atlas shows the plain arrow (a label or
       an agent shows the hand). First the places measured clear in all 80
       views the Atlas flies to at 1366, 1920 and 2560 wide; then a spread
       over the map, inside the panels at any of those widths. */
    { id: 'atlas', kind: '3d', name: 'JARVIS Agent Atlas', method: 'wheel', step: 1.05, rate: 10, turn: 'drag',
      aim: [0.64, 0.77, 0.60, 0.79, 0.66, 0.93, 0.50, 0.90, 0.40, 0.85, 0.35, 0.70,
            0.55, 0.60, 0.45, 0.50, 0.62, 0.45, 0.38, 0.35, 0.55, 0.30, 0.50, 0.20],
      exe: ['jarvis-agent-atlas.exe', 'jarvis agent atlas.exe', 'agent-atlas.exe', 'agent atlas.exe'],
      title: /\bagent\s*atlas\b/i },
    { id: 'browser', kind: 'browser', name: 'Browser', method: 'ctrl_wheel', step: 1.12, rate: 9,
      exe: ['chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe', 'vivaldi.exe', 'arc.exe',
            'chromium.exe', 'waterfox.exe', 'librewolf.exe', 'iexplore.exe', 'zen.exe', 'thorium.exe'] },
    { id: 'pdf', kind: 'document', name: 'PDF viewer', method: 'ctrl_wheel', step: 1.12, rate: 9,
      exe: ['acrobat.exe', 'acrord32.exe', 'sumatrapdf.exe', 'foxitpdfreader.exe', 'foxitreader.exe',
            'foxitpdfeditor.exe', 'pdfxedit.exe', 'pdfxcview.exe', 'nitropdf.exe', 'pdfgear.exe', 'okular.exe'] },
    { id: 'document', kind: 'document', name: 'Document', method: 'ctrl_wheel', step: 1.1, rate: 9,
      exe: ['winword.exe', 'excel.exe', 'powerpnt.exe', 'onenote.exe', 'visio.exe', 'soffice.bin',
            'swriter.exe', 'scalc.exe', 'simpress.exe', 'wps.exe', 'et.exe', 'wpp.exe'] },
    { id: 'image', kind: 'image', name: 'Image viewer', method: 'ctrl_wheel', step: 1.15, rate: 10,
      exe: ['photos.exe', 'microsoft.photos.exe', 'photosapp.exe', 'i_view64.exe', 'i_view32.exe', 'xnview.exe',
            'xnviewmp.exe', 'imageglass.exe', 'honeyview.exe', 'nomacs.exe', 'fsviewer.exe', 'mspaint.exe',
            'paintdotnet.exe', 'gimp-2.10.exe', 'gimp-3.0.exe', 'gimp.exe', 'krita.exe', 'inkscape.exe',
            'figma.exe', 'affinityphoto.exe', 'affinityphoto2.exe', 'affinitydesigner2.exe'],
      cls: ['Photo_Lightweight_Viewer'] },
    { id: 'photoshop', kind: 'image', name: 'Photoshop', method: 'alt_wheel', step: 1.15, rate: 10,
      exe: ['photoshop.exe'] },
    { id: '3d', kind: '3d', name: '3D application', method: 'wheel', step: 1.12, rate: 12,
      exe: ['blender.exe', 'fusion360.exe', 'sketchup.exe', 'freecad.exe', '3dviewer.exe', '3dsmax.exe', 'maya.exe',
            'cinema 4d.exe', 'rhino.exe', 'acad.exe', 'houdini.exe', 'houdinifx.exe', 'unity.exe', 'unrealeditor.exe',
            'meshmixer.exe', 'meshlab.exe', 'f3d.exe', 'bambustudio.exe', 'prusaslicer.exe', 'cura.exe',
            'ultimaker-cura.exe', 'orcaslicer.exe', 'godot.exe'] },
    { id: 'terminal', kind: 'text', name: 'Terminal', method: 'ctrl_wheel', step: 1.1, rate: 8,
      exe: ['windowsterminal.exe'], cls: ['ConsoleWindowClass', 'CASCADIA_HOSTING_WINDOW_CLASS'] },
    { id: 'editor', kind: 'text', name: 'Text editor', method: 'ctrl_wheel', step: 1.1, rate: 8,
      exe: ['notepad.exe', 'notepad++.exe', 'wordpad.exe'] },
    { id: 'electron', kind: 'app', name: 'App', method: 'ctrl_keys', step: 1.1, rate: 6,
      exe: ['code.exe', 'cursor.exe', 'slack.exe', 'discord.exe', 'ms-teams.exe', 'teams.exe', 'spotify.exe',
            'whatsapp.exe', 'obsidian.exe', 'notion.exe', 'postman.exe', 'signal.exe', 'telegram.exe'] },
    { id: 'files', kind: 'files', name: 'File Explorer', method: 'ctrl_wheel', step: 1.2, rate: 6,
      cls: ['CabinetWClass'] }
  ];
  const JARVIS_3D = { id: 'jarvis3d', kind: '3d', name: 'JARVIS 3D viewer', method: 'direct', supported: true };
  const JARVIS_WEB = { id: 'jarvisweb', kind: 'browser', name: 'JARVIS workspace', method: 'ctrl_wheel', step: 1.12, rate: 9, supported: true };
  const GENERIC = { id: 'generic', kind: 'generic', name: 'App', method: 'ctrl_wheel', step: 1.12, rate: 8 };
  const SHELL_EXE = ['lockapp.exe', 'searchhost.exe', 'searchapp.exe', 'startmenuexperiencehost.exe',
                     'shellexperiencehost.exe', 'textinputhost.exe'];
  const SHELL_CLASS = ['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'NotifyIconOverflowWindow',
                       'TopLevelWindowForOverflowXamlIsland', 'Windows.UI.Core.CoreWindow'];

  /* info comes from Rust's zoom_target. Returns the adapter with
     supported:true, or supported:false and why — it never guesses at a
     window it has reason to distrust. */
  function selectAdapter(info){
    if(!info || !info.hwnd) return { supported: false, reason: 'no window is in front' };
    const exe = String(info.exe || '').toLowerCase();
    const cls = String(info.class || '');
    const label = (a) => Object.assign({ supported: true, app: info.title || exe || cls }, a);
    if(info.own === 'model') return label(JARVIS_3D);
    if(info.own && String(info.own).indexOf('ws-') === 0) return label(JARVIS_WEB);
    if(info.own) return { supported: false, reason: 'that is JARVIS himself' };
    if(info.minimized) return { supported: false, reason: 'the window is minimised' };
    if(SHELL_EXE.indexOf(exe) >= 0 || SHELL_CLASS.indexOf(cls) >= 0){
      return { supported: false, reason: 'the desktop and taskbar have no content to zoom' };
    }
    for(const a of ADAPTERS){
      if((a.exe && a.exe.indexOf(exe) >= 0) || (a.cls && a.cls.indexOf(cls) >= 0) ||
         (a.title && a.title.test(String(info.title || '')))) return label(a);
    }
    /* A Chromium window from a program that is not a browser is an
       Electron app, and those zoom from the keyboard. */
    if(cls === 'Chrome_WidgetWin_1') return label(ADAPTERS.find(a => a.id === 'electron'));
    /* Nothing known. A windowed app gets the touchpad-pinch convention; a
       full-screen one does not — an unknown full-screen program is most
       likely a game, where Ctrl+wheel is a weapon switch, not a zoom. */
    if(info.fullscreen) return { supported: false, reason: 'a full-screen program JARVIS does not know — not guessing' };
    return label(GENERIC);
  }

  /* ------------------------------------------------------------------
     THE ZOOM MANAGER — from "the hands moved a step" to what the program
     in front actually receives: one wheel notch, one key press, or (our
     own 3D viewer) one factor of STEP_3D, per step.

     Steps are sent one at a time, no faster than the program's rate and
     the maximum-speed setting, so it moves gradually however fast the
     hands do; at most about a second's worth waits, so a fast sweep does
     not leave a long tail of zoom behind it after the hands have stopped.

     The foreground is re-read at the start of every gesture and every
     half second during one, so switching programs mid-stretch hands the
     gesture to the new one. The zoom level is tracked per window from
     where JARVIS first found it, and the minimum and maximum zoom stop the
     steps at those levels.
  ------------------------------------------------------------------ */
  const STEP_3D = 1.1;

  class ZoomManager {
    constructor(opts){
      this.invoke = opts.invoke;              // (cmd, args) => Promise
      this.emit = opts.emit || (() => {});    // (event, payload) => void
      this.now = opts.now || (() => Date.now());
      this.onStatus = opts.onStatus || (() => {});
      this.gesture = opts.gesture;
      this.settings = normaliseSettings(opts.settings);
      this.levels = new Map();
      this.reset();
    }
    configure(s){ this.settings = normaliseSettings(s); }
    reset(){
      this.active = false; this.target = null; this.adapter = null; this.sent = 0; this.pending = 0;
      this.busy = false; this.lastSendAt = 0; this.lastCheck = 0; this.checking = false; this.startLevel = 1;
      this.generation = (this.generation || 0) + 1;
    }
    keyOf(info){ return info ? String(info.hwnd) + '|' + (info.exe || '') : ''; }
    stepFactor(){ return !this.adapter ? 1 : this.adapter.method === 'direct' ? STEP_3D : (this.adapter.step || 1.1); }
    levelNow(){ return this.startLevel * Math.pow(this.stepFactor(), this.sent); }

    async handle(ev){
      if(!ev || !this.settings.enabled) return;
      if(ev.type === 'start') return this.begin();
      if(ev.type === 'move') return this.move(ev);
      if(ev.type === 'end') return this.end(ev);
    }

    async readTarget(){
      try{ return await this.invoke('zoom_target'); }
      catch(e){ return { hwnd: 0, error: String((e && e.message) || e) }; }
    }

    useTarget(info){
      const adapter = selectAdapter(info);
      this.target = info; this.adapter = adapter;
      if(!adapter.supported){
        this.active = false;
        this.onStatus({ kind: 'unsupported', reason: adapter.reason || info.error || 'cannot zoom that' });
        return false;
      }
      this.active = true;
      this.startLevel = this.levels.get(this.keyOf(info)) || 1;
      this.sent = 0;
      this.onStatus({ kind: 'target', adapter: adapter.id, method: adapter.method, name: adapter.name, app: adapter.app });
      return true;
    }

    async begin(){
      const gen = ++this.generation;
      this.reset(); this.generation = gen;
      const info = await this.readTarget();
      if(gen !== this.generation) return;           // released while we were looking
      this.lastCheck = this.now();
      this.useTarget(info);
    }

    remember(){
      if(this.target && this.adapter && this.adapter.supported){
        this.levels.set(this.keyOf(this.target), this.levelNow());
      }
    }

    /* One more step in direction n (+1/-1) would leave the allowed range. */
    atLimit(n){
      const next = this.levelNow() * Math.pow(this.stepFactor(), n);
      return (n > 0 && next > this.settings.maxZoom * 1.0001) || (n < 0 && next < this.settings.minZoom * 0.9999);
    }

    move(ev){
      const now = this.now();
      const cap = Math.max(1, Math.round(this.settings.maxSpeed));
      this.pending = clamp(this.pending + (ev.steps || 0), -cap, cap);
      /* Which window is in front, every half second, without holding the frame. */
      if(!this.checking && now - this.lastCheck > 500 && this.target !== null){
        this.checking = true; this.lastCheck = now;
        const gen = this.generation;
        this.readTarget().then(info => {
          this.checking = false;
          if(gen !== this.generation) return;
          if(this.keyOf(info) !== this.keyOf(this.target)){ this.remember(); this.pending = 0; this.useTarget(info); }
        });
      }
      if(!this.active || !this.adapter){ if(this.target) this.pending = 0; return; }
      if(!this.pending || this.busy) return;
      const a = this.adapter;
      const rate = Math.min(a.method === 'direct' ? 20 : (a.rate || 8), this.settings.maxSpeed);
      if(now - this.lastSendAt < 1000 / rate) return;
      const n = Math.sign(this.pending);
      if(this.atLimit(n)){
        this.pending = 0;
        this.onStatus({ kind: 'limit', level: this.levelNow(), name: a.name, app: a.app });
        return;
      }
      this.pending -= n;
      this.lastSendAt = now;

      if(a.method === 'direct'){
        this.sent += n;
        this.emit('jarvis://model-zoom', { factor: Math.pow(STEP_3D, n), level: this.levelNow() });
        this.onStatus({ kind: 'zoom', level: this.levelNow(), adapter: a.id, name: a.name, app: a.app });
        return;
      }

      this.busy = true;
      const gen = this.generation, target = this.target;
      this.invoke('zoom_send', a.aim ? { hwnd: target.hwnd, method: a.method, notches: n, aim: a.aim }
                                     : { hwnd: target.hwnd, method: a.method, notches: n }).then(() => {
        if(gen !== this.generation) return;
        this.sent += n;
        this.onStatus({ kind: 'zoom', level: this.levelNow(), adapter: a.id, name: a.name, app: a.app });
      }).catch((e) => {
        if(gen !== this.generation) return;
        const why = String((e && e.message) || e);
        /* He switched programs between our check and the notch: re-read and
           carry on with the new one rather than aiming at the old. */
        if(/foreground changed/i.test(why)){ this.lastCheck = 0; return; }
        this.active = false;
        this.onStatus({ kind: 'error', reason: why });
      }).then(() => { if(gen === this.generation) this.busy = false; });
    }

    end(){
      this.remember();
      if(this.adapter && this.adapter.method === 'direct') this.emit('jarvis://model-zoom', { factor: 1, end: true });
      const was = this.adapter;
      this.reset();
      this.onStatus({ kind: 'idle', last: was && was.name });
    }
  }

  /* ------------------------------------------------------------------
     THE TRACKER — MediaPipe's HandLandmarker, from ./vendor/mediapipe, so
     it works offline and nothing about his hands leaves the machine. GPU
     first, CPU if the GPU path will not start.
  ------------------------------------------------------------------ */
  async function createTracker(opts){
    opts = opts || {};
    const base = opts.base || './vendor/mediapipe';
    const V = root.Vision;
    if(!V || !V.FilesetResolver || !V.HandLandmarker) throw new Error('the hand-tracking library did not load');
    const fileset = await V.FilesetResolver.forVisionTasks(base + '/wasm');
    const order = opts.delegate === 'CPU' ? ['CPU'] : ['GPU', 'CPU'];
    let lm = null, used = null, lastErr = null;
    for(const delegate of order){
      try{
        lm = await V.HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: base + '/hand_landmarker.task', delegate },
          runningMode: 'VIDEO', numHands: 2,
          /* 0.55 / 0.5 / 0.5, measured: 0.4 (tried in 2.13.1) kept a
             degraded track and read real OK signs as open hands. */
          minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5
        });
        used = delegate; break;
      }catch(e){ lastErr = e; }
    }
    if(!lm) throw lastErr || new Error('the hand tracker would not start');
    let lastTs = 0, hands = 2, switching = false;
    return {
      delegate: used,
      /* How many hands it looks for (2.21.0). With two asked for and one in
         view it runs the palm detector on EVERY frame to find the other, which
         is half of what a read costs (measured: 117 ms against 65 on the CPU
         path). Changing it reconfigures the graph (about 15 ms) and the next
         read finds the hand again, so it is done rarely. */
      get hands(){ return hands; },
      get busy(){ return switching; },
      setHands(n){
        if(n === hands || switching) return false;
        switching = true; hands = n;
        Promise.resolve().then(() => lm.setOptions({ numHands: n })).catch(() => {}).then(() => { switching = false; });
        return true;
      },
      detect(source, tMs){
        const ts = Math.max(lastTs + 1, Math.round(tMs));      // must strictly increase
        lastTs = ts;
        const r = lm.detectForVideo(source, ts);
        return (r.landmarks || []).map((L, i) => ({ landmarks: L,
          handedness: (r.handedness && r.handedness[i] && r.handedness[i][0] && r.handedness[i][0].categoryName) || '',
          score: (r.handedness && r.handedness[i] && r.handedness[i][0] && r.handedness[i][0].score) || 0 }));
      },
      close(){ try{ lm.close(); }catch(e){} }
    };
  }

  /* ------------------------------------------------------------------
     THE OVERLAY — every hand JARVIS sees, whole (2.12.0): all 21 points
     and the bones between them, so he can see the hand is tracked before
     he pinches; then the two pinch points and the line between them for a
     zoom (grey open, cyan pinched, green zooming), and for precise control
     the turning hand in amber with a line from where the turn began.
     Mapped through object-fit: cover, and mirrored with the picture.
  ------------------------------------------------------------------ */
  const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
                 [9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
  const TURN_COL = '#ffc94d';
  const POINTER_COL = '#ff7bd5';
  function drawOverlay(canvas, video, ev, label){
    if(!canvas || !video) return;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const dpr = root.devicePixelRatio || 1;
    if(canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)){
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const vw = video.videoWidth, vh = video.videoHeight;
    if(!vw || !vh || !ev) return;
    const sc = Math.max(W / vw, H / vh), ox = (W - vw * sc) / 2, oy = (H - vh * sc) / 2;
    const map = (p) => ({ x: ox + p.x * sc, y: oy + p.y * sc });
    const pts = (ev.points || []).map(p => p && map(p));
    const zooming = ev.state === 'zooming', ready = ev.state === 'armed' || ev.state === 'arming';
    const col = zooming ? '#4dffb0' : ready ? '#00e5ff' : 'rgba(190,220,235,0.55)';
    const turn = ev.turn || {};
    const turningSlot = (turn.state === 'armed' || turn.state === 'turning') ? turn.slot : -1;
    /* The whole hand, every hand in view. */
    (ev.hands || []).forEach(h => {
      if(!h || !h.pts || h.pts.length < 21) return;
      const P = h.pts.map(map);
      const engaged = ev.engaged && h.slot != null && ev.engaged[h.slot];
      const hc = h.slot === turningSlot ? TURN_COL : engaged ? col : 'rgba(150,215,240,0.6)';
      g.strokeStyle = hc; g.lineWidth = 1.5; g.globalAlpha = engaged || h.slot === turningSlot ? 0.9 : 0.6;
      g.beginPath();
      BONES.forEach(([a, b]) => { g.moveTo(P[a].x, P[a].y); g.lineTo(P[b].x, P[b].y); });
      g.stroke();
      g.fillStyle = hc;
      P.forEach(p => { g.beginPath(); g.arc(p.x, p.y, 2.2, 0, Math.PI * 2); g.fill(); });
      g.globalAlpha = 1;
    });
    /* The finger that is the mouse (2.16.0): a ring at its tip, filling
       as it folds into a click. */
    if(ev.pointerTip){
      /* 2.18.0: the ring closes as the finger bends toward the click (45°). */
      const c = map(ev.pointerTip), down = ev.pointerState === 'folding' || ev.pointerState === 'clicked';
      const k = ev.pointerState === 'clicked' ? 1 : clamp((ev.pointerBend || 0) / CLICK_DEG, 0, 1);
      g.strokeStyle = POINTER_COL; g.lineWidth = 2;
      g.beginPath(); g.arc(c.x, c.y, 11 - 4 * k, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(c.x - 16, c.y); g.lineTo(c.x - 12, c.y); g.moveTo(c.x + 12, c.y); g.lineTo(c.x + 16, c.y);
      g.moveTo(c.x, c.y - 16); g.lineTo(c.x, c.y - 12); g.moveTo(c.x, c.y + 12); g.lineTo(c.x, c.y + 16); g.stroke();
      if(down){ g.fillStyle = POINTER_COL; g.globalAlpha = ev.pointerState === 'clicked' ? 0.85 : 0.4; g.beginPath(); g.arc(c.x, c.y, 7, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
    }
    /* Precise control: where the turn began, and where the hand is now. */
    if(turningSlot >= 0 && turn.origin && turn.center){
      const o = map(turn.origin), c = map(turn.center);
      g.strokeStyle = TURN_COL; g.lineWidth = 2;
      g.setLineDash([4, 4]); g.beginPath(); g.arc(o.x, o.y, 11, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      g.beginPath(); g.moveTo(o.x, o.y); g.lineTo(c.x, c.y); g.stroke();
      g.beginPath(); g.arc(c.x, c.y, 7, 0, Math.PI * 2); g.fillStyle = TURN_COL; g.globalAlpha = 0.5; g.fill(); g.globalAlpha = 1; g.stroke();
    }
    if(pts[0] && pts[1] && (ready || zooming)){
      g.strokeStyle = col; g.lineWidth = 2; g.setLineDash(zooming ? [] : [6, 5]);
      g.beginPath(); g.moveTo(pts[0].x, pts[0].y); g.lineTo(pts[1].x, pts[1].y); g.stroke();
      g.setLineDash([]);
    }
    pts.forEach((p, i) => {
      if(!p) return;
      const on = ev.engaged && ev.engaged[i];
      g.beginPath(); g.arc(p.x, p.y, on ? 9 : 6, 0, Math.PI * 2);
      g.strokeStyle = on ? col : 'rgba(190,220,235,0.55)'; g.lineWidth = 2; g.stroke();
      if(on){ g.fillStyle = col; g.globalAlpha = 0.35; g.fill(); g.globalAlpha = 1; }
    });
    if(label){
      /* The picture is mirrored with a CSS transform; text must not be. */
      const mirrored = /scaleX\(-1\)|matrix\(-1/.test(getComputedStyle(canvas).transform || '');
      g.save();
      if(mirrored){ g.translate(W, 0); g.scale(-1, 1); }
      g.font = '10px "Courier New", monospace';
      const w = g.measureText(label).width + 12;
      g.fillStyle = 'rgba(3,8,15,0.72)'; g.fillRect(8, 8, w, 18);
      g.fillStyle = /^(?:TURN|SCROLL)/.test(label) ? TURN_COL : /^(?:POINTER|CLICK)/.test(label) ? POINTER_COL : col; g.fillText(label, 14, 21);
      g.restore();
    }
  }

  /* ------------------------------------------------------------------
     THE CONTROLLER — camera frames in, zoom out.

     EVERY FRAME, ONCE (2.13.0). Detection used to run on a timer: 30 ms
     after the last detection with hands in view, 110 ms without. A timer
     knows nothing of the camera, so frames that arrived between two ticks
     were never looked at, the same frame was sometimes read twice, and a
     hand coming into view waited out the slow idle tick first — what he
     saw as the tracking missing frames and stuttering. Now the video
     itself calls in (requestVideoFrameCallback) for every frame it
     presents, and that frame, and only that one, goes to the tracker, at
     whatever rate the camera runs; with hands or without. Where the
     callback does not exist, animation frames read the video whenever
     its picture changed. stats() counts frames read, frames the video
     presented that were never read (missed), and the rate.
     Nothing runs at all while the feature is off.
  ------------------------------------------------------------------ */
  function startGestureZoom(o){
    const video = o.video, overlay = o.overlay;
    const now = () => (root.performance && root.performance.now ? root.performance.now() : Date.now());
    let settings = normaliseSettings(o.settings);
    const gesture = new HandGestures(settings);
    const bump = new FistBump();
    let bumpLabel = '', bumpLabelUntil = 0;
    /* The bump's one job: the window he is in, minimised by Rust. */
    function minimiseNow(t){
      bumpLabel = 'MINIMISE'; bumpLabelUntil = t + 1200;
      if(!o.invoke) return;
      Promise.resolve().then(() => o.invoke('minimize_window')).then(r => {
        if(r && r.ok){ bumpLabel = 'MINIMISED' + (r.title ? ' · ' + r.title : ''); bumpLabelUntil = now() + 1500; }
        else { bumpLabel = 'NOTHING TO MINIMISE'; bumpLabelUntil = now() + 1500; }
        if(o.onStatus) o.onStatus({ kind: 'minimize', ok: !!(r && r.ok), title: r && r.title, own: r && r.own });
      }).catch(err => {
        const msg = String((err && err.message) || err);
        bumpLabel = /not found|unknown command|not allowed/i.test(msg) ? 'MINIMISE NEEDS THE REBUILT APP' : 'MINIMISE FAILED';
        bumpLabelUntil = now() + 2500;
        if(o.onStatus) o.onStatus({ kind: 'minimize', ok: false, reason: msg });
      });
    }
    let label = '', turnLabel = '';
    const status = (s) => {
      if(s.kind === 'target') label = 'ZOOM · ' + (s.name || '');
      else if(s.kind === 'zoom') label = 'ZOOM · ' + (s.name || '') + ' ×' + s.level.toFixed(2);
      else if(s.kind === 'limit') label = 'ZOOM · ' + (s.name || '') + ' ×' + s.level.toFixed(2) + ' (limit)';
      else if(s.kind === 'unsupported') label = 'NO ZOOM · ' + s.reason;
      else if(s.kind === 'error') label = 'ZOOM FAILED · ' + s.reason;
      else if(s.kind === 'idle') label = '';
      if(o.onStatus) o.onStatus(s);
    };
    const manager = new ZoomManager({ invoke: o.invoke, emit: o.emit, gesture, settings, onStatus: status });
    const relay = new TurnRelay({ emit: o.emit, invoke: o.invoke, speed: () => settings.scrollSpeed, onStatus: (s) => {
      if(s.kind === 'turn-ready') turnLabel = (s.mode === 'scroll' ? 'SCROLL · READY' : 'TURN · READY') + (s.name ? ' · ' + s.name : '');
      else if(s.kind === 'turn-none') turnLabel = 'TURN · no 3D model open';
      else if(s.kind === 'turn') turnLabel = (s.mode === 'scroll' ? 'SCROLL · ' : 'TURN · ') + (s.name || '3D model');
      else if(s.kind === 'turn-failed') turnLabel = 'TURN FAILED · ' + (s.reason || '');
      else if(s.kind === 'turn-idle') turnLabel = '';
      if(o.onStatus) o.onStatus(s);
    } });
    let pointerLabel = '';
    const pointer = new PointerRelay({ invoke: o.invoke, onStatus: (s) => {
      if(s.kind === 'pointer') pointerLabel = 'POINTER';
      else if(s.kind === 'pointer-click') pointerLabel = 'CLICK';
      else if(s.kind === 'pointer-failed') pointerLabel = 'POINTER FAILED · ' + (s.reason || '');
      else if(s.kind === 'pointer-idle') pointerLabel = '';
      if(o.onStatus) o.onStatus(s);
    } });
    if(o.listen){
      try{
        Promise.resolve(o.listen('jarvis://model-pong', (e) => relay.pong(e && e.payload))).catch(() => {});
        Promise.resolve(o.listen('jarvis://model-gone', () => relay.gone())).catch(() => {});
      }catch(e){}
    }
    let pingTimer = null;
    let tracker = null, loading = null, running = false, timer = null, handsAt = -1e9, lastEv = null, frames = 0, spent = 0;
    /* What the camera and the tracker really do (2.20.0), measured, not read
       from the camera's settings: how many pictures a second the camera
       gives, how many the tracker reads, how long a read takes, and how old
       a picture is when it has been read (the browser stamps each frame
       with the moment the camera captured it). */
    let lateEma = null, inferEma = null, camFps = 0, trackFps = 0, perfAt = 0, perfN = 0, perfP0 = -1, perfT0 = 0, capturedStamps = false;
    let rec = null;
    /* A FILTER ON HIS HANDS (2.25.0, the web shooters). While one is set the
       tracker keeps reading (two hands) and hands each read to it, and NOTHING
       reaches the computer: no zoom, no turn, no scroll, no finger mouse.
       Whatever was under way ends the moment it is set. It runs even with
       hand control switched off in the settings. */
    let filterFn = null;
    function endGestures(){
      relay.handle({ type: 'end', state: 'idle' });
      pointer.handle({ type: 'end' });
      if(gesture.state !== 'idle') manager.handle({ type: 'end' });
      gesture.resetGesture();
      drawOverlay(overlay, video, null, '');
    }
    /* Which program is in front, about once a second even between
       gestures. Rust remembers the last program he was in only when it is
       asked; without this, clicking the camera window and then pinching
       found nothing to hand the gesture to. */
    let probeAt = -1e9, probing = false, lastApp;
    function probeForeground(t){
      if(probing || t - probeAt < 1000 || !o.invoke) return;
      probing = true; probeAt = t;
      Promise.resolve().then(() => o.invoke('zoom_target')).then(info => {
        const a = selectAdapter(info);
        const name = a.supported ? a.name : null;
        /* Where one pinched hand goes: a drag for the Atlas, JARVIS's own
           viewer, the wheel (scrolling) for anything else that takes it —
           not a 3D program, whose wheel is its zoom. (The finger's pointer
           needs no target: it is the mouse, everywhere.) */
        const kind = !a.supported || info.minimized ? null : info.own === 'model' ? 'viewer'
                   : a.turn === 'drag' ? 'drag' : a.kind === '3d' ? null : 'scroll';
        relay.setTarget(kind ? { hwnd: info.hwnd, name: a.name, kind, aim: a.aim } : null);
        if(name !== lastApp){
          lastApp = name;
          if(o.onStatus) o.onStatus({ kind: 'foreground', name, supported: !!a.supported, reason: a.reason || null });
        }
      }).catch(() => {}).then(() => { probing = false; });
    }

    let delegate = o.delegate, switched = false;
    /* The first reads of a GPU path compile its shaders and take a second or
       more; the verdict on a path is the MEDIAN of the reads after that
       (GPU_WARMUP skipped), taken once there are GPU_JUDGE_AT. (It was the mean
       of the first 20 including that one — enough to send a fast GPU path to
       the CPU for good.) */
    const GPU_WARMUP = 6, GPU_JUDGE_AT = 36, GPU_TOO_SLOW_MS = 70;
    let reads = [], inputCanvas = null, inputCtx = null, inputW = 0, lastHandsSwitch = -1e9;
    function ensureTracker(){
      if(tracker) return Promise.resolve(tracker);
      if(!loading){
        loading = createTracker({ base: o.base, delegate }).then(t => {
          tracker = t;
          if(o.onStatus) o.onStatus({ kind: 'ready', delegate: t.delegate });
          return t;
        }).catch(e => { loading = null; if(o.onStatus) o.onStatus({ kind: 'failed', reason: String((e && e.message) || e) }); throw e; });
      }
      return loading;
    }
    const byFrame = typeof video.requestVideoFrameCallback === 'function';
    const raf = root.requestAnimationFrame ? root.requestAnimationFrame.bind(root) : (f) => setTimeout(() => f(now()), 16);
    const unraf = root.cancelAnimationFrame ? root.cancelAnimationFrame.bind(root) : clearTimeout;
    let missed = 0, repeats = 0, lastPresented = -1, lastMedia = -1, fpsAt = 0, fpsN = 0, fps = 0;
    /* RESTING WHILE NO HAND IS THERE (2.22.0). Every frame is read while a
       hand is in view; with none for IDLE_AFTER_MS, at most one read every
       IDLE_EVERY_MS — the tracker was taking a whole core (and the GPU) all
       day for an empty picture, beside JARVIS's own page. A hand coming in
       is seen within one of those reads, and then every frame again. */
    const IDLE_AFTER_MS = 2000, IDLE_EVERY_MS = 120;
    let lastReadAt = -1e9, idleSkips = 0;
    function schedule(){
      if(!running || timer) return;
      timer = byFrame ? { vfc: video.requestVideoFrameCallback(onFrame) } : { raf: raf(onPaint) };
    }
    function unschedule(){
      if(!timer) return;
      try{
        if(timer.vfc != null) video.cancelVideoFrameCallback(timer.vfc);
        if(timer.raf != null) unraf(timer.raf);
      }catch(e){}
      timer = null;
    }
    function onFrame(_, meta){
      timer = null;
      if(!running) return;
      const n = meta && typeof meta.presentedFrames === 'number' ? meta.presentedFrames : -1;
      if(n >= 0 && tracker){
        if(lastPresented >= 0 && n > lastPresented + 1) missed += n - lastPresented - 1;
        if(n === lastPresented) repeats++;
        lastPresented = n;
      }
      tick(meta);
      schedule();
    }
    function onPaint(){
      timer = null;
      if(!running) return;
      /* Only a new picture: the same one twice is wasted work. */
      const m = video.currentTime;
      if(m !== lastMedia){ lastMedia = m; tick(null); }
      schedule();
    }
    /* What the tracker is given. On the CPU path a 1280-wide picture costs
       about 30% more than the same picture at 960 (measured; the hand's
       points differ by under half a camera pixel), so it is drawn smaller
       first. The GPU path takes the video as it is. */
    function trackerInput(){
      const w = settings.trackWidth;
      if(!w || !tracker || tracker.delegate !== 'CPU' || !root.document || video.videoWidth <= w) { inputW = video.videoWidth; return video; }
      const h = Math.round(video.videoHeight * w / video.videoWidth);
      if(!inputCanvas){ inputCanvas = root.document.createElement('canvas'); inputCtx = inputCanvas.getContext('2d'); }
      if(inputCanvas.width !== w || inputCanvas.height !== h){ inputCanvas.width = w; inputCanvas.height = h; }
      inputCtx.drawImage(video, 0, 0, w, h);
      inputW = w;
      return inputCanvas;
    }
    function tick(meta){
      if(!running) return;
      try{
        if(tracker && video.readyState >= 2 && video.videoWidth){
          if(tracker.busy) return;                              // a reconfigure is under way (a few ms)
          const t = now();
          if(!rec && t - handsAt > IDLE_AFTER_MS && t - lastReadAt < IDLE_EVERY_MS){ idleSkips++; return; }
          lastReadAt = t;
          const hands = tracker.detect(trackerInput(), t);
          const t2 = now();
          frames++; spent += t2 - t;
          fpsN++;
          reads.push(t2 - t);
          /* Measured: the read, the picture's age, the camera's real rate. */
          inferEma = inferEma === null ? t2 - t : inferEma + ((t2 - t) - inferEma) * 0.1;
          if(meta && typeof meta.captureTime === 'number'){
            const age = t2 - meta.captureTime;
            if(age >= 0 && age < 1500){ capturedStamps = true; lateEma = lateEma === null ? age : lateEma + (age - lateEma) * 0.1; }
          }
          perfN++;
          if(perfAt === 0){ perfAt = t2; perfN = 0; perfP0 = meta && typeof meta.presentedFrames === 'number' ? meta.presentedFrames : -1; }
          else if(t2 - perfAt >= 1000){
            const secs = (t2 - perfAt) / 1000;
            trackFps = perfN / secs;
            camFps = (perfP0 >= 0 && meta && typeof meta.presentedFrames === 'number') ? (meta.presentedFrames - perfP0) / secs : trackFps;
            perfAt = t2; perfN = 0; perfP0 = meta && typeof meta.presentedFrames === 'number' ? meta.presentedFrames : -1;
            if(o.onStatus) o.onStatus({ kind: 'perf', camFps, trackFps, inferMs: inferEma, lateMs: lateEma, delegate: tracker.delegate, hands: tracker.hands, inputW,
                                        resting: t2 - handsAt > IDLE_AFTER_MS });
          }
          pointer.setLate(lateEma);
          if(t2 - fpsAt >= 1000){ fps = fpsAt ? fpsN * 1000 / (t2 - fpsAt) : 0; fpsAt = t2; fpsN = 0; }
          if(hands.length) handsAt = t2;
          /* A GPU path that is slow — a machine with no real GPU, or a
             broken driver, runs it in software — is worse than the CPU one.
             Measured over the first frames, and switched once. */
          if(!switched && tracker.delegate === 'GPU' && reads.length === GPU_JUDGE_AT && median(reads.slice(GPU_WARMUP)) > GPU_TOO_SLOW_MS){
            switched = true;
            try{ tracker.close(); }catch(e){}
            tracker = null; loading = null; delegate = 'CPU'; frames = 0; spent = 0; reads = [];
            ensureTracker().catch(() => {});
            return;
          }
          if(filterFn){
            if(tracker.hands !== 2 && t2 - lastHandsSwitch > 1500 && tracker.setHands(2)) lastHandsSwitch = t2;
            try{ filterFn({ t: t2, hands, width: video.videoWidth, height: video.videoHeight }); }
            catch(e){ if(o.onStatus) o.onStatus({ kind: 'error', reason: 'filter: ' + String((e && e.message) || e) }); }
            if(rec) recordFrame(t2, t, meta, hands, {});
            return;
          }
          const ev = gesture.update({ t: t2, hands, width: video.videoWidth, height: video.videoHeight });
          lastEv = ev;
          /* Two fists: nothing else uses them (a fist is never a pinch or a
             pointing finger), so the bump is read alongside, and only while
             no zoom, turn or finger mouse is under way. */
          if(settings.bumpEnabled && !ev.active){
            ev.bump = bump.update(t2, gesture.zoom.lastMetrics);
            if(ev.bump.type === 'bump') minimiseNow(t2);
          } else if(bump.state !== 'idle') bump.reset();
          /* ONE HAND WHILE THE FINGER IS THE MOUSE (2.21.0): the second-hand
             search is half of a read, and he cannot start a zoom with the
             other hand while pointing anyway (one gesture at a time). Back to
             two as soon as the pointer lets go. Not more often than every 1.5
             s: each change costs a re-detection. */
          if(settings.oneHandPointing && t2 - lastHandsSwitch > 1500){
            const want = ev.pointer && ev.pointer.state !== 'idle' ? 1 : 2;
            if(tracker.hands !== want && tracker.setHands(want)) lastHandsSwitch = t2;
          }
          if(ev.state === 'idle') probeForeground(t2);
          manager.handle(ev);
          if(settings.turnEnabled) relay.handle(ev.turn);
          pointer.handle(ev.pointer);
          /* The pointing fingertip, drawn while it is the mouse. */
          if(pointer.active && ev.pointer && ev.pointer.state !== 'idle'){
            const h = (ev.hands || []).find(x => x.slot === gesture.pointer.slot);
            ev.pointerTip = h && h.pts ? h.pts[8] : null;
            ev.pointerState = ev.pointer.state;
            ev.pointerBend = ev.pointer.bend || 0;
          }
          if(rec) recordFrame(t2, t, meta, hands, ev);
          drawOverlay(overlay, video, ev, (rec ? 'REC ' + Math.max(0, Math.ceil((rec.until - t2) / 1000)) + ' s' : '') ||
                      (t2 < bumpLabelUntil ? bumpLabel : '') || label || (ev.state === 'armed' ? 'ZOOM · READY' : '') || pointerLabel || turnLabel);
        }
      }catch(e){ if(o.onStatus) o.onStatus({ kind: 'error', reason: String((e && e.message) || e) }); }
    }
    /* THE RECORDER (2.20.0): half a minute of what the tracker saw, for
       studying on his own camera and hands. Per frame: when it was read, how
       long that took, the camera's stamps for it, the 21 points of each
       hand and how sure the tracker was of it, and what the gestures did.
       No picture. */
    const r1 = (v) => Math.round(v * 10) / 10, r4 = (v) => Math.round(v * 10000) / 10000;
    function recordFrame(t2, t, meta, hands, ev){
      const row = { t: r1(t2), inf: r1(t2 - t) };
      if(meta){
        if(typeof meta.captureTime === 'number') row.c = r1(meta.captureTime);
        if(typeof meta.mediaTime === 'number') row.m = r4(meta.mediaTime);
        if(typeof meta.presentedFrames === 'number') row.pf = meta.presentedFrames;
        if(typeof meta.expectedDisplayTime === 'number') row.d = r1(meta.expectedDisplayTime);
        if(typeof meta.receiveTime === 'number') row.rc = r1(meta.receiveTime);
      }
      row.h = (hands || []).map(h => ({ s: r4(h.score || 0), w: (h.handedness || '')[0] || '',
        p: (h.landmarks || []).map(p => [r4(p.x), r4(p.y), r4(p.z || 0)]) }));
      const p = ev.pointer || {};
      row.ptr = [p.type || '', p.state || '', p.x == null ? null : r4(p.x), p.y == null ? null : r4(p.y), r4(p.vx || 0), r4(p.vy || 0), Math.round((p.bend || 0) * 10) / 10];
      row.trn = (ev.turn && ev.turn.type) || '';
      row.zm = ev.state || '';
      row.nh = tracker ? tracker.hands : 0;
      rec.rows.push(row);
      if(t2 - rec.reported >= 1000){ rec.reported = t2; if(o.onStatus) o.onStatus({ kind: 'recording', left: Math.max(0, Math.ceil((rec.until - t2) / 1000)) }); }
      if(t2 >= rec.until) finishRecording();
    }
    function finishRecording(){
      const r = rec; rec = null;
      if(!r) return;
      const rows = r.rows, n = rows.length;
      const withHand = rows.filter(x => x.h.length).length;
      const dur = n > 1 ? (rows[n - 1].t - rows[0].t) / 1000 : 0;
      let longestGap = 0, gap = 0;
      for(const x of rows){ if(x.h.length) gap = 0; else { gap++; longestGap = Math.max(longestGap, gap); } }
      const summary = { frames: n, seconds: Math.round(dur * 10) / 10, trackFps: dur ? Math.round(n / dur * 10) / 10 : 0,
                        framesWithHand: withHand, longestHandlessRun: longestGap,
                        inferMs: inferEma === null ? null : Math.round(inferEma), lateMs: lateEma === null ? null : Math.round(lateEma), camFps: Math.round(camFps * 10) / 10 };
      r.header.summary = summary;
      const text = '{"header":' + JSON.stringify(r.header) + ',"frames":[\n' + rows.map(x => JSON.stringify(x)).join(',\n') + '\n]}';
      r.resolve({ text, frames: n, summary });
    }

    const api = {
      gesture, manager, relay, pointer, bump,
      /* Record `seconds` of tracking; resolves with { text, frames, summary }. */
      record(seconds){
        return new Promise((resolve) => {
          if(rec || !running){ resolve(null); return; }
          const secs = Math.max(3, Math.min(90, Number(seconds) || 30));
          let info = null; try{ info = o.trackInfo ? o.trackInfo() : null; }catch(e){}
          const t = now();
          rec = { rows: [], until: t + secs * 1000, reported: t, resolve, header: {
            format: 'jarvis-tracking-1', startedAt: new Date().toISOString(), seconds: secs,
            userAgent: root.navigator ? root.navigator.userAgent : '',
            screen: root.screen ? { w: root.screen.width, h: root.screen.height, dpr: root.devicePixelRatio || 1 } : null,
            video: { w: video.videoWidth, h: video.videoHeight, input: inputW }, delegate: tracker && tracker.delegate,
            hasCaptureTime: capturedStamps, camera: info, settings } };
          if(o.onStatus) o.onStatus({ kind: 'recording', left: secs });
        });
      },
      /* Set a filter (a function given each read), or null to give the hands
         back to the gestures. */
      setFilter(fn){
        filterFn = typeof fn === 'function' ? fn : null;
        if(filterFn){
          endGestures();
          if(!running) api.start();
        } else if(!settings.enabled) api.stop();
        return !!filterFn;
      },
      get filtering(){ return !!filterFn; },
      start(){
        if(running || (!settings.enabled && !filterFn)) return Promise.resolve(false);
        running = true;
        /* Whether a 3D model is open, every two seconds, for precise control. */
        if(!pingTimer && o.listen){ relay.ping(); pingTimer = setInterval(() => relay.ping(), 2000); }
        return ensureTracker().then(() => { if(running) schedule(); return true; }, () => { running = false; return false; });
      },
      stop(){
        running = false;
        if(rec) finishRecording();
        unschedule();
        if(pingTimer){ clearInterval(pingTimer); pingTimer = null; }
        relay.handle({ type: 'end', state: 'idle' });
        pointer.handle({ type: 'end' });
        if(gesture.state !== 'idle'){ manager.handle({ type: 'end' }); }
        gesture.resetGesture();
        drawOverlay(overlay, video, null, '');
      },
      configure(s){
        settings = normaliseSettings(s);
        gesture.configure(settings); manager.configure(settings);
        if(settings.enabled || filterFn) api.start(); else api.stop();
      },
      stats(){ return { frames, avgMs: frames ? spent / frames : 0, running, delegate: tracker && tracker.delegate, switched,
                        missed, repeats, fps, everyFrame: byFrame, handsAt, last: lastEv,
                        camFps, trackFps, inferMs: inferEma, lateMs: lateEma, stamped: capturedStamps, recording: !!rec,
                        hands: tracker && tracker.hands, inputW, idleSkips, resting: now() - handsAt > IDLE_AFTER_MS, filtering: !!filterFn }; }
    };
    return api;
  }

  root.JarvisGestureZoom = {
    DEFAULTS, LIMITS, STORE_KEY, normaliseSettings, OneEuro, handMetrics, PinchState, TwoHandZoom,
    HandGestures, TurnRelay, PointerTracker, PointerRelay, BONES, FistBump, isFist,
    ADAPTERS, selectAdapter, ZoomManager, createTracker, drawOverlay, startGestureZoom,
    constants: { PINCH_ON, PINCH_OFF, FIST_GUARD, PALM_CM, PALM_RAY, ARM_MS, STEP_3D,
                 TURN_ARM_MS, TURN_DEAD_MM, TURN_JUMP, TURN_MAX_FRAME, TURN_PRESENT_MS, TURN_KEEP_MS, SCROLL_UNITS_PER_DEG,
                 FINGER_STRAIGHT, FINGER_FOLDED, OTHERS_OPEN, POINT_ARM_DEG, STRAIGHT_DEG, CLICK_DEG,
                 POINT_ARM_MS, FOLD_FRAMES, CLICK_REARM, LEAVE_FRAMES, POINT_LOST_MS, POINTER_BOX, POINTER_FILTER, TURN_GRACE_MS,
                 POINTER_VEL_ALPHA, JUMP_GATE, JUMP_SPEED, JUMP_ACCEPT, JUMP_SAME, POSE_GRACE_FRAMES, STUCK_DEG, STUCK_REARM_MS,
                 BUMP_APART, BUMP_TOUCH, BUMP_NEAR, BUMP_WINDOW_MS, BUMP_APART_FRAMES, BUMP_BEND_DEG, BUMP_LOST_MS, BUMP_COOL_MS }
  };
})(typeof window !== 'undefined' ? window : globalThis);
