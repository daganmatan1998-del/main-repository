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
    turnScreen: 0.75    // the share of the picture the hand crosses for one full turn (360°)
  });
  const LIMITS = {
    sensitivity: [0.25, 3], threshold: [0, 30], smoothing: [0, 1],
    maxSpeed: [1, 15], maxZoom: [1.2, 20], minZoom: [0.05, 0.9], turnScreen: [0.25, 1.5]
  };
  const STORE_KEY = 'jarvis_store:gesture_zoom';

  function normaliseSettings(s){
    const out = Object.assign({}, DEFAULTS);
    if(s && typeof s === 'object'){
      if(typeof s.enabled === 'boolean') out.enabled = s.enabled;
      if(typeof s.turnEnabled === 'boolean') out.turnEnabled = s.turnEnabled;
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
    return {
      scale, deep,
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
  const TURN_ARM_MS = 220, TURN_DEAD_MM = 4, TURN_JUMP = 2.5, TURN_MAX_FRAME = 90;

  class HandGestures {
    constructor(settings){
      this.zoom = new TwoHandZoom(settings);
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
    resetGesture(){ this.zoom.resetGesture(); this.resetTurn(); this.latch = false; }
    resetTurn(){
      this.turn = { state: 'idle', slot: -1, armStart: 0, scale: 0, origin: null, last: null,
                    prevRaw: null, originPx: null, total: { x: 0, y: 0 } };
      if(this.fx){ this.fx.reset(); this.fy.reset(); }
    }

    update(frame){
      const ev = this.zoom.update(frame);
      ev.hands = (this.zoom.lastMetrics || []).map(m => ({ pts: m.pts, center: m.center, slot: m.slot }));
      const e = ev.engaged || [false, false];
      if(e[0] && e[1]) this.latch = true;
      if(!e[0] && !e[1]) this.latch = false;
      ev.turn = this.turnStep(frame.t, e, frame.width, frame.height);
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
      if(!this.s.turnEnabled || !single || this.latch) return this.endTurn();
      const slot = e[0] ? 0 : 1;
      const m = this.zoom.pins[slot].last;
      if(!m || !m.center) return this.endTurn();
      let T = this.turn;
      if(T.state !== 'idle' && T.slot !== slot){ const ended = this.endTurn(); if(ended.type === 'end') return ended; T = this.turn; }
      const raw = m.center;
      const view = (extra) => Object.assign({ state: T.state, slot, center: raw, origin: T.originPx, dx: 0, dy: 0,
                                              total: { x: T.total.x, y: T.total.y } }, extra || {});
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
     Rust's watchdog would let go of the button under a held pinch. */
  const TURN_PRESENT_MS = 6000, TURN_KEEP_MS = 400;
  class TurnRelay {
    constructor(o){
      o = o || {};
      this.emit = o.emit || (() => {});
      this.invoke = o.invoke || null;
      this.now = o.now || (() => Date.now());
      this.onStatus = o.onStatus || (() => {});
      this.lastPong = -1e9; this.loaded = false;
      this.target = null; this.drag = null; this.busy = false;
      this.reset();
    }
    reset(){ this.sentStart = false; this.pinged = false; this.armedShown = false; this.mode = null; }
    pong(p){ this.lastPong = this.now(); this.loaded = !(p && p.loaded === false); }
    gone(){ this.lastPong = -1e9; this.loaded = false; }
    /* { hwnd, name } of a program in front that turns by dragging, or null. */
    setTarget(t){ this.target = (t && t.hwnd && this.invoke) ? { hwnd: t.hwnd, name: t.name || 'the 3D view', aim: t.aim || null } : null; }
    viewerOpen(){ return this.loaded && this.now() - this.lastPong < TURN_PRESENT_MS; }
    present(){ return !!this.target || this.viewerOpen(); }
    ping(){ try{ this.emit('jarvis://model-ping', {}); }catch(e){} }
    handle(turn){
      if(!turn) return;
      if(turn.state === 'arming' && !this.pinged){ this.pinged = true; this.ping(); }
      if(turn.type === 'start'){
        this.armedShown = true;
        this.onStatus(this.present() ? { kind: 'turn-ready', name: this.target ? this.target.name : null } : { kind: 'turn-none' });
        return;
      }
      if(turn.type === 'move' && (turn.dx || turn.dy)){
        if(!this.mode){
          if(this.target){ this.mode = 'drag'; this.drag = { hwnd: this.target.hwnd, name: this.target.name, aim: this.target.aim, started: false,
                                                               pdx: 0, pdy: 0, keep: false, keptAt: this.now(), ending: false }; }
          else if(this.viewerOpen()) this.mode = 'viewer';
          else return;
        }
        if(this.mode === 'failed') return;
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
    let lastTs = 0;
    return {
      delegate: used,
      detect(source, tMs){
        const ts = Math.max(lastTs + 1, Math.round(tMs));      // must strictly increase
        lastTs = ts;
        const r = lm.detectForVideo(source, ts);
        return (r.landmarks || []).map((L, i) => ({ landmarks: L,
          handedness: (r.handedness && r.handedness[i] && r.handedness[i][0] && r.handedness[i][0].categoryName) || '' }));
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
      g.fillStyle = /^TURN/.test(label) ? TURN_COL : col; g.fillText(label, 14, 21);
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
    const relay = new TurnRelay({ emit: o.emit, invoke: o.invoke, onStatus: (s) => {
      if(s.kind === 'turn-ready') turnLabel = 'TURN · READY' + (s.name ? ' · ' + s.name : '');
      else if(s.kind === 'turn-none') turnLabel = 'TURN · no 3D model open';
      else if(s.kind === 'turn') turnLabel = 'TURN · ' + (s.name || '3D model');
      else if(s.kind === 'turn-failed') turnLabel = 'TURN FAILED · ' + (s.reason || '');
      else if(s.kind === 'turn-idle') turnLabel = '';
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
        /* A program that turns by a drag (the Atlas) takes precise control. */
        relay.setTarget(a.supported && a.turn === 'drag' && !info.minimized ? { hwnd: info.hwnd, name: a.name, aim: a.aim } : null);
        if(name !== lastApp){
          lastApp = name;
          if(o.onStatus) o.onStatus({ kind: 'foreground', name, supported: !!a.supported, reason: a.reason || null });
        }
      }).catch(() => {}).then(() => { probing = false; });
    }

    let delegate = o.delegate, switched = false;
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
      tick();
      schedule();
    }
    function onPaint(){
      timer = null;
      if(!running) return;
      /* Only a new picture: the same one twice is wasted work. */
      const m = video.currentTime;
      if(m !== lastMedia){ lastMedia = m; tick(); }
      schedule();
    }
    function tick(){
      if(!running) return;
      try{
        if(tracker && video.readyState >= 2 && video.videoWidth){
          const t = now();
          const hands = tracker.detect(video, t);
          const t2 = now();
          frames++; spent += t2 - t;
          fpsN++;
          if(t2 - fpsAt >= 1000){ fps = fpsAt ? fpsN * 1000 / (t2 - fpsAt) : 0; fpsAt = t2; fpsN = 0; }
          if(hands.length) handsAt = t2;
          /* A GPU path that is slow — a machine with no real GPU, or a
             broken driver, runs it in software — is worse than the CPU one.
             Measured over the first frames, and switched once. */
          if(frames === 20 && !switched && tracker.delegate === 'GPU' && spent / frames > 70){
            switched = true;
            try{ tracker.close(); }catch(e){}
            tracker = null; loading = null; delegate = 'CPU'; frames = 0; spent = 0;
            ensureTracker().catch(() => {});
          }
          const ev = gesture.update({ t: t2, hands, width: video.videoWidth, height: video.videoHeight });
          lastEv = ev;
          if(ev.state === 'idle') probeForeground(t2);
          manager.handle(ev);
          if(settings.turnEnabled) relay.handle(ev.turn);
          drawOverlay(overlay, video, ev, label || (ev.state === 'armed' ? 'ZOOM · READY' : '') || turnLabel);
        }
      }catch(e){ if(o.onStatus) o.onStatus({ kind: 'error', reason: String((e && e.message) || e) }); }
    }
    const api = {
      gesture, manager, relay,
      start(){
        if(running || !settings.enabled) return Promise.resolve(false);
        running = true;
        /* Whether a 3D model is open, every two seconds, for precise control. */
        if(!pingTimer && o.listen){ relay.ping(); pingTimer = setInterval(() => relay.ping(), 2000); }
        return ensureTracker().then(() => { if(running) schedule(); return true; }, () => { running = false; return false; });
      },
      stop(){
        running = false;
        unschedule();
        if(pingTimer){ clearInterval(pingTimer); pingTimer = null; }
        relay.handle({ type: 'end', state: 'idle' });
        if(gesture.state !== 'idle'){ manager.handle({ type: 'end' }); }
        gesture.resetGesture();
        drawOverlay(overlay, video, null, '');
      },
      configure(s){
        settings = normaliseSettings(s);
        gesture.configure(settings); manager.configure(settings);
        if(settings.enabled) api.start(); else api.stop();
      },
      stats(){ return { frames, avgMs: frames ? spent / frames : 0, running, delegate: tracker && tracker.delegate, switched,
                        missed, repeats, fps, everyFrame: byFrame, handsAt, last: lastEv }; }
    };
    return api;
  }

  root.JarvisGestureZoom = {
    DEFAULTS, LIMITS, STORE_KEY, normaliseSettings, OneEuro, handMetrics, PinchState, TwoHandZoom,
    HandGestures, TurnRelay, BONES,
    ADAPTERS, selectAdapter, ZoomManager, createTracker, drawOverlay, startGestureZoom,
    constants: { PINCH_ON, PINCH_OFF, FIST_GUARD, PALM_CM, PALM_RAY, ARM_MS, STEP_3D,
                 TURN_ARM_MS, TURN_DEAD_MM, TURN_JUMP, TURN_MAX_FRAME, TURN_PRESENT_MS, TURN_KEEP_MS }
  };
})(typeof window !== 'undefined' ? window : globalThis);
