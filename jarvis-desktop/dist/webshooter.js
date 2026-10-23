/* ------------------------------------------------------------------
   WEB SHOOTERS (2.25.0; 2.26.0: on the FOREARM, and a stream that works
   like the real thing) — his WS-01 web shooter, in the camera window.

   "Activate web shooter" puts the model (filters/ws-01-web-shooter.glb,
   his own file) on every arm the tracker sees; "take down the web
   shooters" takes them off. While they are on, the camera controls nothing
   on the computer (gesture-zoom's setFilter): this file is given each read
   of the hands instead. It is a filter for learning how the device works,
   not a toy: no burst, no splat.

   THE MODEL, measured from the file (metres): X runs along the forearm
   toward the fingers (nozzle at x 0.153, palm trigger 0.23-0.26 in the palm
   under the middle and ring knuckles), Y comes out of the skin (the INNER
   wrist, the palm side), Z points to the thumb (the radial rail). A right
   arm; the left one is its mirror image. The black wire runs from the
   device's front (x 0.152) to the trigger (x 0.233).

   THE FOREARM (2.26.0). The device sits on the forearm, the trigger in the
   palm, and the wrist bends between them — most of all in the thwip, the
   hand cocked back. So the forearm is tracked on its own, best source first:
     1. POSE: MediaPipe's pose landmarker (vendored, lite), elbow to wrist,
        when it sees him (face and shoulders in view) and the elbow is
        visible; the pose wrist must be the hand's wrist.
     2. THE FOREARM ITSELF: skin of the palm's own colour followed out of
        the wrist, ray by ray, away from the fingers; the longest unbroken
        run is the forearm (a close-up, his own photo, no body in view).
     3. The hand's own line, wrist to the middle knuckle (a sleeve, nothing
        else to go on).
   The forearm's turn (palm up or down) is the hand's: the wrist does not
   twist on its own. The device follows the forearm, the trigger the hand,
   and the wire is bent between them every frame.

   THE HAND: wrist (0), middle knuckle (9) = along, pinky knuckle (17) to
   index knuckle (5) = across (to the thumb); out of the palm is their cross
   product, whose sign is the hand — the tracker's label is the real hand on
   an unmirrored picture (measured: right_hands.jpg reads "Right"). Size:
   the palm, wrist to the knuckles, against an adult's 9.2 cm.

   THE TRIGGER: middle and ring folded (bent past 80°), index and pinky out
   — the pose in his photo. Held two frames, the valve opens; two frames
   out of the pose, it closes. While open, fluid leaves the nozzle along
   its own axis (the forearm) at STREAM.SPEED_MPS, falls under gravity, and
   the strand bends as the arm moves, because each bit of it keeps the
   direction it left in. Released, the strand detaches and falls away.
------------------------------------------------------------------ */
(function(root){
  'use strict';
  const GZ = root.JarvisGestureZoom;

  const MODEL = { WRIST_X: 0.16, LIFT_Y: 0.027, NOZZLE: [0.1536, 0.013, 0.006],
                  WIRE_CUT_X: 0.152, WIRE_EXIT: [0.152, 0.0005, -0.0241], WIRE_END: [0.232, -0.0025, -0.002], WIRE_R: 0.0012 };
  const PALM_M = 0.092;            // wrist to the middle knuckle on an adult hand, metres
  const THWIP = { FOLD_ON: 80, FOLD_OFF: 50, OUT_MAX: 55, PINKY_MAX: 70, FRAMES: 2, RELEASE_FRAMES: 2 };
  const STREAM = { SPEED_MPS: 8, GRAVITY: 9.81, LIFE_S: 0.9, MAX_HOLD_S: 4, EMIT_HZ: 120, TWIST_M: 0.004, PITCH_M: 0.05 };
  const POSE = { EVERY_MS: 110, FRESH_MS: 450, MIN_VIS: 0.5, MATCH_PALMS: 0.9, Z_DAMP: 0.6 };
  const SKIN = { RAYS: 43, SPREAD_DEG: 105, FROM: 0.3, TO: 1.8, STEPS: 16, MIN_SCORE: 0.55, WIDTH: 256 };
  const MAX_BEND_DEG = 95;         // forearm to hand: past this it is a misreading
  const LOST_MS = 260;             // a hand unseen this long is put away

  /* --- small vector helpers (video pixels: x right, y down, z away) --- */
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a) => Math.sqrt(dot(a, a));
  const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const orth = (a, n) => { const k = dot(a, n); return [a[0] - n[0] * k, a[1] - n[1] * k, a[2] - n[2] * k]; };
  const angleDeg = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))) * 180 / Math.PI;

  /* --- the trigger: middle and ring folded, index and pinky out ------ */
  function thwipPose(m){
    if(!m || !m.bends) return 'off';
    const b = m.bends;
    if(b.middle >= THWIP.FOLD_ON && b.ring >= THWIP.FOLD_ON && b.index <= THWIP.OUT_MAX && b.pinky <= THWIP.PINKY_MAX) return 'on';
    if(b.middle < THWIP.FOLD_OFF || b.ring < THWIP.FOLD_OFF) return 'off';
    return 'between';
  }
  /* The valve: opens after FRAMES of the pose, closes after RELEASE_FRAMES
     out of it. update() says 'open' / 'close' on the change, else null. */
  class TriggerState {
    constructor(){ this.pressed = false; this.onRun = 0; this.offRun = 0; }
    update(m){
      const on = thwipPose(m) === 'on';
      if(on){ this.offRun = 0; if(!this.pressed && ++this.onRun >= THWIP.FRAMES){ this.pressed = true; this.onRun = 0; return 'open'; } }
      else { this.onRun = 0; if(this.pressed && ++this.offRun >= THWIP.RELEASE_FRAMES){ this.pressed = false; this.offRun = 0; return 'close'; } }
      return null;
    }
  }

  /* --- the hand's own frame -------------------------------------- */
  function handPoints(L, vw, vh){ return L.map(p => [p.x * vw, p.y * vh, (Number(p.z) || 0) * vw]); }
  function handFrame(L, vw, vh, right){
    if(!L || L.length < 21) return null;
    const P = handPoints(L, vw, vh);
    const along = unit(sub(P[9], P[0]));
    const across = unit(orth(sub(P[5], P[17]), along));
    const normal = right ? cross(across, along) : cross(along, across);   // out of the palm
    const palm = (len(sub(P[5], P[0])) + len(sub(P[9], P[0])) + len(sub(P[13], P[0])) + len(sub(P[17], P[0]))) / 4 * 1.03;
    if(!(palm > 4)) return null;
    return { origin: P[0], along, across, normal, right, ppm: palm / PALM_M, palm };
  }
  /* The forearm's frame: along the forearm (toward the hand), out of the
     inner forearm (the palm's normal, square to it), to the thumb. */
  function forearmFrame(hand, F){
    let y = orth(hand.normal, F);
    if(len(y) < 0.2) y = orth(hand.across, F);          // the palm faces straight along the arm: keep a sane twist
    y = unit(y);
    const z = hand.right ? cross(F, y) : cross(y, F);
    return { origin: hand.origin, along: unit(F), normal: y, across: z, right: hand.right, ppm: hand.ppm };
  }
  /* A point given in a frame (metres) back in video pixels. */
  function inVideo(f, x, y, z){
    return [0, 1, 2].map(i => f.origin[i] + (f.along[i] * x + f.normal[i] * y + f.across[i] * z) * f.ppm);
  }

  /* --- the forearm, source 1: the pose ---------------------------- */
  function forearmFromPose(pose, L, vw, vh){
    if(!pose || pose.length < 17 || !L) return null;
    const hw = [L[0].x * vw, L[0].y * vh];
    const palm = handFrame(L, vw, vh, true);
    if(!palm) return null;
    let best = null;
    for(const [wi, ei] of [[15, 13], [16, 14]]){
      const w = pose[wi], e = pose[ei];
      if(!w || !e) continue;
      const d = Math.hypot(w.x * vw - hw[0], w.y * vh - hw[1]);
      if(d <= POSE.MATCH_PALMS * palm.palm && (!best || d < best.d)) best = { d, w, e, side: wi === 15 ? 'left' : 'right' };
    }
    if(!best) return null;
    const vis = Math.min(best.w.visibility == null ? 1 : best.w.visibility, best.e.visibility == null ? 1 : best.e.visibility);
    if(vis < POSE.MIN_VIS) return null;
    const dir = [(best.w.x - best.e.x) * vw, (best.w.y - best.e.y) * vh, (best.w.z - best.e.z) * vw * POSE.Z_DAMP];
    if(len(dir) < 0.5 * palm.palm) return null;            // pointing straight at the camera: no line to read
    return { dir: unit(dir), conf: vis, source: 'pose', elbow: [best.e.x * vw, best.e.y * vh], side: best.side };
  }

  /* --- the forearm, source 2: its own pixels ---------------------- */
  /* The palm's colour: chromaticity and brightness at five points of the
     palm, each a 3x3 average. */
  function skinModel(px, pw, ph, P, sx, sy){
    const at = (x, y) => {
      let r = 0, g = 0, b = 0, n = 0;
      for(let dy = -1; dy <= 1; dy++) for(let dx = -1; dx <= 1; dx++){
        const X = Math.round(x * sx) + dx, Y = Math.round(y * sy) + dy;
        if(X < 0 || Y < 0 || X >= pw || Y >= ph) continue;
        const i = (Y * pw + X) * 4; r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
      }
      return n ? [r / n, g / n, b / n] : null;
    };
    const mid = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    const C = [0, 5, 9, 13, 17].reduce((a, i) => [a[0] + P[i][0] / 5, a[1] + P[i][1] / 5], [0, 0]);
    const pts = [C, mid(P[0], P[9], 0.35), mid(P[0], P[5], 0.4), mid(P[0], P[17], 0.4), mid(C, P[0], 0.5)];
    const cs = pts.map(p => at(p[0], p[1])).filter(Boolean);
    if(cs.length < 3) return null;
    const chroma = cs.map(([r, g, b]) => { const s = r + g + b || 1; return [r / s, g / s, s / 3]; });
    const mean = [0, 1, 2].map(k => chroma.reduce((a, c) => a + c[k], 0) / chroma.length);
    const sd = [0, 1].map(k => Math.sqrt(chroma.reduce((a, c) => a + (c[k] - mean[k]) ** 2, 0) / chroma.length));
    return { r: mean[0], g: mean[1], lum: mean[2], tol: 0.03 + 2.5 * Math.max(sd[0], sd[1]) };
  }
  function isSkin(px, i, m){
    const r = px[i], g = px[i + 1], b = px[i + 2], s = r + g + b || 1, l = s / 3;
    return Math.abs(r / s - m.r) <= m.tol && Math.abs(g / s - m.g) <= m.tol && l >= m.lum * 0.45 && l <= m.lum * 1.8 + 12;
  }
  /* The hand's own outline (its 21 points' hull, a little grown): skin
     inside it is the palm or the thumb, not the forearm. */
  function handHull(P){
    const p = P.map(q => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for(const q of p){ while(lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for(const q of p.slice().reverse()){ while(hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
    const h = lo.slice(0, -1).concat(hi.slice(0, -1));
    const c = h.reduce((a, q) => [a[0] + q[0] / h.length, a[1] + q[1] / h.length], [0, 0]);
    return h.map(q => [c[0] + (q[0] - c[0]) * 1.06, c[1] + (q[1] - c[1]) * 1.06]);
  }
  function inside(poly, x, y){
    let r = false;
    for(let i = 0, j = poly.length - 1; i < poly.length; j = i++){
      const a = poly[i], b = poly[j];
      if((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) r = !r;
    }
    return r;
  }
  /* Rays out of the wrist, away from the fingers; on each, how far the skin
     runs unbroken outside the hand's own outline (one miss forgiven; out of
     the picture still skin = half credit for the rest). The forearm is the
     MIDDLE of the band of long rays — every ray inside a wide arm is long,
     so the single longest one is anywhere across it. A picture where most
     directions are "skin" (a wall of that colour) has no arm to find:
     nothing is claimed rather than a guess. */
  function forearmFromPixels(px, pw, ph, L, vw, vh){
    if(!px || !L || L.length < 21) return null;
    const sx = pw / vw, sy = ph / vh;
    const P = handPoints(L, vw, vh);
    const palmPx = Math.hypot(P[9][0] - P[0][0], P[9][1] - P[0][1]) || 1;
    const m = skinModel(px, pw, ph, P, sx, sy);
    if(!m) return null;
    const hull = handHull(P);
    const back = Math.atan2(P[0][1] - P[9][1], P[0][0] - P[9][0]);
    const N = SKIN.RAYS, spread = SKIN.SPREAD_DEG * Math.PI / 180;
    const ang = [], score = [];
    for(let k = 0; k < N; k++){
      const a = back - spread + 2 * spread * k / (N - 1);
      ang.push(a);
      let run = 0, missed = 0, counted = 0;
      for(let s = 0; s < SKIN.STEPS; s++){
        const d = (SKIN.FROM + (SKIN.TO - SKIN.FROM) * s / (SKIN.STEPS - 1)) * palmPx;
        const x = P[0][0] + Math.cos(a) * d, y = P[0][1] + Math.sin(a) * d;
        const X = Math.round(x * sx), Y = Math.round(y * sy);
        if(X < 0 || Y < 0 || X >= pw || Y >= ph){ if(counted >= 1 && run === counted) run += (SKIN.STEPS - s) * 0.5; break; }
        if(inside(hull, x, y)) continue;                     // the hand itself: neither for nor against
        counted++;
        if(isSkin(px, (Y * pw + X) * 4, m)){ run++; missed = 0; }
        else if(++missed > 1) break;
      }
      score.push(run / SKIN.STEPS);
    }
    const top = Math.max.apply(null, score);
    if(top < SKIN.MIN_SCORE) return null;
    if(score.filter(s => s >= 0.5 * top).length > N * 0.45) return null;   // no contrast: a skin-coloured background
    /* The band: the run of rays near the top around the best one. */
    let bi = score.indexOf(top), lo = bi, hi = bi;
    while(lo > 0 && score[lo - 1] >= 0.85 * top) lo--;
    while(hi < N - 1 && score[hi + 1] >= 0.85 * top) hi++;
    let wx = 0, wy = 0;
    for(let k = lo; k <= hi; k++){ wx += Math.cos(ang[k]) * score[k]; wy += Math.sin(ang[k]) * score[k]; }
    const coarse = Math.atan2(wy, wx);
    /* Then the arm's own centre line: the principal axis, through the
       wrist, of the skin in a cone around that (polar samples, symmetric
       about any axis, so the arm's width cannot pull it to one side). */
    /* Only out to where the whole cone is still in the picture: an arm
       leaving it at the edge is cut on one side first, which would tilt
       the axis. */
    let mxx = 0, myy = 0, mxy = 0, n = 0, reach = 0;
    for(let r = 0.4; r <= SKIN.TO + 1e-9; r += 0.1){
      let whole = true;
      for(let da = -35; da <= 35 && whole; da += 5){
        const a = coarse + da * Math.PI / 180, d = r * palmPx;
        const X = (P[0][0] + Math.cos(a) * d) * sx, Y = (P[0][1] + Math.sin(a) * d) * sy;
        if(X < 0 || Y < 0 || X >= pw || Y >= ph) whole = false;
      }
      if(!whole) break;
      reach = r;
      for(let da = -35; da <= 35; da += 2.5){
        const a = coarse + da * Math.PI / 180, d = r * palmPx;
        const x = P[0][0] + Math.cos(a) * d, y = P[0][1] + Math.sin(a) * d;
        const X = Math.round(x * sx), Y = Math.round(y * sy);
        if(inside(hull, x, y)) continue;
        if(!isSkin(px, (Y * pw + X) * 4, m)) continue;
        const ex = x - P[0][0], ey = y - P[0][1];
        mxx += ex * ex; myy += ey * ey; mxy += ex * ey; n++;
      }
    }
    let a = coarse;
    if(n >= 12 && reach >= 0.9){
      const axis = 0.5 * Math.atan2(2 * mxy, mxx - myy);
      const flip = Math.cos(axis - coarse) < 0 ? Math.PI : 0;
      const fine = axis + flip;
      if(Math.cos(fine - coarse) > Math.cos(25 * Math.PI / 180)) a = fine;   // a refinement, never a different answer
    }
    return { dir2: [-Math.cos(a), -Math.sin(a)], conf: top, source: 'pixels', band: [lo, hi] };   // from the elbow toward the wrist
  }
  /* The pixel direction is flat; its tilt toward the camera is taken from
     the hand's (a straight wrist would make them one line). */
  function lift2d(dir2, hand){
    const a2 = Math.hypot(hand.along[0], hand.along[1]);
    const slope = Math.max(-1.5, Math.min(1.5, hand.along[2] / Math.max(0.3, a2)));
    return unit([dir2[0], dir2[1], slope]);
  }
  /* The forearm to use now, and where it came from. */
  function chooseForearm(hand, poseHit, pixelHit){
    const sane = (F) => F && angleDeg(F, hand.along) <= MAX_BEND_DEG;
    if(poseHit && sane(poseHit.dir)) return { dir: poseHit.dir, source: 'pose' };
    if(pixelHit){ const F = lift2d(pixelHit.dir2, hand); if(sane(F)) return { dir: F, source: 'pixels' }; }
    return { dir: hand.along, source: 'hand' };
  }

  /* --- the filter ------------------------------------------------- */
  function create(o){
    const THREE = root.THREE;
    const stage = o.stage, video = o.video;
    const mk = (id) => { const c = root.document.createElement('canvas'); c.id = id; stage.appendChild(c); return c; };
    const glCanvas = mk('ws3d'), fx = mk('wsfx');
    let renderer = null, scene = null, camera = null, model = null, trigger = null, wireMat = null, raf = 0, active = false;
    let mirrored = !!(o.mirrored && o.mirrored());
    let poseLm = null, poseTs = 0, poseAt = -1e9, poseResult = null, poseState = 'off';
    let grab = null, grabCtx = null;
    const tracks = [];
    let nextId = 1, shots = 0, frames = 0, W = 0, H = 0, drawn = 0, lastDraw = 0, statusAt = 0;
    const now = () => (root.performance && root.performance.now ? root.performance.now() : Date.now());

    function setMirrored(m){
      mirrored = !!m;
      glCanvas.classList.toggle('mirrored', mirrored);
      fx.classList.toggle('mirrored', mirrored);
    }
    setMirrored(mirrored);

    /* The pose tracker, for the forearm: loaded beside the model, and
       optional — without it the forearm comes from its pixels. */
    function loadPose(){
      const V = root.Vision || root.vision;
      if(!o.poseModel || !V || !V.PoseLandmarker || !V.FilesetResolver) { poseState = 'unavailable'; return Promise.resolve(false); }
      poseState = 'loading';
      return V.FilesetResolver.forVisionTasks(o.wasmBase || './vendor/mediapipe/wasm').then(async (fs) => {
        for(const delegate of (o.delegate === 'CPU' ? ['CPU'] : ['GPU', 'CPU'])){
          try{
            poseLm = await V.PoseLandmarker.createFromOptions(fs, {
              baseOptions: { modelAssetPath: o.poseModel, delegate }, runningMode: 'VIDEO', numPoses: 1,
              minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
            poseState = 'ready (' + delegate + ')';
            return true;
          }catch(e){ poseLm = null; }
        }
        poseState = 'failed';
        return false;
      }).catch(() => { poseState = 'failed'; return false; });
    }

    function load(url){
      if(model) return Promise.resolve(true);
      if(!THREE || !THREE.GLTFLoader) return Promise.reject(new Error('three.js is not loaded'));
      renderer = new THREE.WebGLRenderer({ canvas: glCanvas, alpha: true, antialias: true, premultipliedAlpha: true });
      renderer.setClearColor(0x000000, 0);
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      scene = new THREE.Scene();
      if(THREE.RoomEnvironment && THREE.PMREMGenerator){
        try{
          const pmrem = new THREE.PMREMGenerator(renderer);
          scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
          pmrem.dispose();
        }catch(e){ /* lit by the lights alone */ }
      }
      scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 0.7));
      const key = new THREE.DirectionalLight(0xffffff, 1.3);
      key.position.set(0.3, 1, 1.2);
      scene.add(key);
      camera = new THREE.OrthographicCamera(0, 1, 0, -1, -20000, 20000);
      loadPose();
      return new Promise((resolve, reject) => {
        new THREE.GLTFLoader().load(url, (gltf) => { prepare(gltf.scene); resolve(true); },
                                    undefined, (err) => reject(new Error('the web shooter model would not load: ' + ((err && err.message) || err))));
      });
    }

    /* The palm trigger goes with the hand, the rest with the forearm; the
       black wire is cut where it leaves the device, and the rest of it is
       drawn between the two every frame. */
    function prepare(sceneRoot){
      sceneRoot.updateMatrixWorld(true);
      sceneRoot.traverse((n) => {
        if(n.name === 'PALM_TRIGGER') trigger = n;
        if(n.isMesh && n.material && n.material.name === 'Wire_black' && !wireMat){
          wireMat = n.material;
          n.geometry = cutBelow(n.geometry, MODEL.WIRE_CUT_X);
        }
      });
      if(trigger && trigger.parent) trigger.parent.remove(trigger);
      model = sceneRoot;
    }
    function cutBelow(geo, maxX){
      const pos = geo.attributes.position, idx = geo.index;
      const keep = [];
      const n = idx ? idx.count : pos.count;
      for(let i = 0; i < n; i += 3){
        const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
        if(pos.getX(a) <= maxX && pos.getX(b) <= maxX && pos.getX(c) <= maxX) keep.push(a, b, c);
      }
      const g = geo.clone();
      g.setIndex(keep);
      return g;
    }

    function makeTrack(){
      const hide = new THREE.MeshBasicMaterial({ colorWrite: false });
      /* The forearm: the device, and the arm as depth. */
      const arm = new THREE.Group(); arm.matrixAutoUpdate = false;
      const dev = model.clone(true); dev.position.set(-MODEL.WRIST_X, MODEL.LIFT_Y, 0); arm.add(dev);
      const armGeo = new THREE.CylinderGeometry(1, 1, 1, 28, 1, false);
      armGeo.rotateZ(-Math.PI / 2); armGeo.scale(0.27, 0.021, 0.031); armGeo.translate(-0.12, 0, 0);
      const armHide = new THREE.Mesh(armGeo, hide); armHide.renderOrder = -1; arm.add(armHide);
      /* The hand: the trigger in the palm, and the palm as depth. */
      const hand = new THREE.Group(); hand.matrixAutoUpdate = false;
      if(trigger){ const t = trigger.clone(true); const wrap = new THREE.Group(); wrap.position.set(-MODEL.WRIST_X, MODEL.LIFT_Y, 0); wrap.add(t); hand.add(wrap); }
      const palmGeo = new THREE.BoxGeometry(0.125, 0.028, 0.092); palmGeo.translate(0.0575, 0, 0);
      const palmHide = new THREE.Mesh(palmGeo, hide); palmHide.renderOrder = -1; hand.add(palmHide);
      const wire = new THREE.Mesh(new THREE.BufferGeometry(), wireMat || new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }));
      [arm, hand, wire].forEach(g => { g.visible = false; scene.add(g); });
      const e1 = (mc, b) => new GZ.OneEuro(mc, b, 1);
      return { id: nextId++, vote: 0, right: undefined, arm, hand, wire, trig: new TriggerState(),
               f: { o: [e1(1.2, 0.02), e1(1.2, 0.02), e1(1.2, 0.02)], a: [e1(1.5, 0.6), e1(1.5, 0.6), e1(1.5, 0.6)],
                    c: [e1(1.5, 0.6), e1(1.5, 0.6), e1(1.5, 0.6)], s: e1(1.0, 0.005), F: [e1(1.0, 0.5), e1(1.0, 0.5), e1(1.0, 0.5)] },
               frame: null, fore: null, source: 'hand', seen: 0, bends: null,
               stream: [], openSince: 0, emitAcc: 0, emitN: 0 };
    }

    /* Pixels of the frame, small, for the forearm's skin. */
    function framePixels(){
      if(!video || !video.videoWidth || !root.document) return null;
      const w = SKIN.WIDTH, h = Math.round(video.videoHeight * w / video.videoWidth);
      if(!grab){ grab = root.document.createElement('canvas'); grabCtx = grab.getContext('2d', { willReadFrequently: true }); }
      if(grab.width !== w || grab.height !== h){ grab.width = w; grab.height = h; }
      try{ grabCtx.drawImage(video, 0, 0, w, h); return { px: grabCtx.getImageData(0, 0, w, h).data, w, h }; }catch(e){ return null; }
    }

    /* Each read of the hands (from the tracker). */
    function update(frame){
      if(!active || !model || !frame) return;
      frames++;
      const vw = frame.width, vh = frame.height, t = frame.t;
      const hands = (frame.hands || []).filter(h => h.landmarks && h.landmarks.length >= 21);
      if(poseLm && hands.length && t - poseAt >= POSE.EVERY_MS && video && video.readyState >= 2){
        poseAt = t;
        try{ poseTs = Math.max(poseTs + 1, Math.round(t)); const r = poseLm.detectForVideo(video, poseTs); poseResult = { at: t, lm: (r.landmarks && r.landmarks[0]) || null }; }
        catch(e){ poseResult = null; }
      }
      const pix = hands.length ? framePixels() : null;
      const seen = new Set();
      for(const h of hands){
        const L = h.landmarks;
        const wx = L[0].x * vw, wy = L[0].y * vh;
        let tr = null, best = 0.25 * vw;
        for(const c of tracks){
          if(seen.has(c) || !c.frame) continue;
          const d = Math.hypot(c.frame.origin[0] - wx, c.frame.origin[1] - wy);
          if(d < best){ best = d; tr = c; }
        }
        if(!tr){ if(tracks.length >= 2) continue; tr = makeTrack(); tracks.push(tr); }
        seen.add(tr);
        /* Right or left, steadied by a vote with a margin. */
        const v = (h.handedness === 'Left' ? -1 : 1) * Math.max(0.3, h.score || 0.5);
        tr.vote = tr.vote + (v - tr.vote) * 0.3;
        if(tr.right === undefined) tr.right = tr.vote >= 0;
        else if(tr.right && tr.vote < -0.25) tr.right = false;
        else if(!tr.right && tr.vote > 0.25) tr.right = true;
        const raw = handFrame(L, vw, vh, tr.right);
        if(!raw) continue;
        const fo = raw.origin.map((x, i) => tr.f.o[i].filter(x, t));
        const fa = unit(raw.along.map((x, i) => tr.f.a[i].filter(x, t)));
        const fc = unit(orth(raw.across.map((x, i) => tr.f.c[i].filter(x, t)), fa));
        const hand = { origin: fo, along: fa, across: fc, normal: tr.right ? cross(fc, fa) : cross(fa, fc), right: tr.right, ppm: tr.f.s.filter(raw.ppm, t) };
        /* The forearm, from the best source there is. */
        const poseHit = poseResult && t - poseResult.at <= POSE.FRESH_MS ? forearmFromPose(poseResult.lm, L, vw, vh) : null;
        const pixelHit = pix ? forearmFromPixels(pix.px, pix.w, pix.h, L, vw, vh) : null;
        const pick = chooseForearm(raw, poseHit, pixelHit);
        const F = unit(pick.dir.map((x, i) => tr.f.F[i].filter(x, t)));
        tr.source = pick.source;
        tr.frame = hand;
        tr.fore = forearmFrame(hand, F);
        tr.seen = t; tr.vw = vw; tr.vh = vh;
        const m = GZ && GZ.handMetrics ? GZ.handMetrics(L, vw, vh) : null;
        tr.bends = m && m.bends;
        const edge = tr.trig.update(m);
        if(edge === 'open'){
          tr.openSince = t; tr.emitAcc = 0; shots++;
          if(o.onShot) try{ o.onShot({ hand: tr.right ? 'right' : 'left' }); }catch(e){}
        }
      }
      /* A hand gone closes its valve. */
      for(const tr of tracks) if(!seen.has(tr) && tr.trig.pressed && t - tr.seen > LOST_MS){ tr.trig.pressed = false; }
    }

    /* Video pixels to the canvas (object-fit: cover), and to the 3D world
       (y up, z toward the viewer). */
    function cover(vw, vh){
      const sc = Math.max(W / vw, H / vh);
      return { sc, ox: (W - vw * sc) / 2, oy: (H - vh * sc) / 2 };
    }
    function toWorld(p, cv){ return new THREE.Vector3(cv.ox + p[0] * cv.sc, -(cv.oy + p[1] * cv.sc), -p[2] * cv.sc); }
    function placeGroup(g, f, cv){
      const w = (v) => new THREE.Vector3(v[0], -v[1], -v[2]);
      const s = f.ppm * cv.sc;
      g.matrix.copy(new THREE.Matrix4().makeBasis(w(f.along), w(f.normal), w(f.across))).scale(new THREE.Vector3(s, s, s)).setPosition(toWorld(f.origin, cv));
      g.matrixWorldNeedsUpdate = true;
    }
    /* The wire from the device's front to the trigger, bent at the wrist. */
    function placeWire(tr, cv){
      const ex = MODEL.WIRE_EXIT, en = MODEL.WIRE_END, X = MODEL.WRIST_X, Y = MODEL.LIFT_Y;
      const pts = [
        inVideo(tr.fore, ex[0] - X, ex[1] + Y, ex[2]),
        inVideo(tr.fore, ex[0] - X + 0.014, ex[1] + Y - 0.002, ex[2]),
        inVideo(tr.frame, en[0] - X - 0.022, en[1] + Y, en[2] - 0.012),
        inVideo(tr.frame, en[0] - X, en[1] + Y, en[2])
      ].map(p => toWorld(p, cv));
      const curve = new THREE.CatmullRomCurve3(pts);
      const old = tr.wire.geometry;
      tr.wire.geometry = new THREE.TubeGeometry(curve, 24, MODEL.WIRE_R * tr.frame.ppm * cv.sc, 6, false);
      if(old) old.dispose();
    }

    function resize(){
      const w = stage.clientWidth, h = stage.clientHeight;
      if(w === W && h === H) return;
      W = w; H = h;
      const dpr = root.devicePixelRatio || 1;
      renderer.setPixelRatio(dpr);
      renderer.setSize(W, H, false);
      fx.width = Math.round(W * dpr); fx.height = Math.round(H * dpr);
      camera.left = 0; camera.right = W; camera.top = 0; camera.bottom = -H;
      camera.updateProjectionMatrix();
    }

    function draw(){
      raf = 0;
      if(!active) return;
      resize();
      const t = now(), dt = Math.min(0.05, lastDraw ? (t - lastDraw) / 1000 : 0.016);
      lastDraw = t;
      for(const tr of tracks){
        const visible = !!(tr.frame && tr.fore && t - tr.seen < LOST_MS && tr.vw);
        [tr.arm, tr.hand, tr.wire].forEach(g => { g.visible = visible; });
        if(visible){
          const cv = cover(tr.vw, tr.vh);
          placeGroup(tr.arm, tr.fore, cv);
          placeGroup(tr.hand, tr.frame, cv);
          placeWire(tr, cv);
        }
        flow(tr, t, dt);
      }
      for(let i = tracks.length - 1; i >= 0; i--){
        const tr = tracks[i];
        if(t - tr.seen > 1500 && !tr.stream.length){ [tr.arm, tr.hand, tr.wire].forEach(g => scene.remove(g)); if(tr.wire.geometry) tr.wire.geometry.dispose(); tracks.splice(i, 1); }
      }
      renderer.render(scene, camera);
      drawn = renderer.info.render.triangles;
      drawStreams();
      if(o.onStatus && t - statusAt > 250){ statusAt = t; try{ o.onStatus(readout()); }catch(e){} }
      raf = root.requestAnimationFrame(draw);
    }

    /* --- the stream ------------------------------------------------- */
    /* While the valve is open, fluid leaves the nozzle along its axis (the
       forearm) at SPEED_MPS; every bit then flies on its own, under gravity,
       so the strand bends as the arm moves. After MAX_HOLD_S the cartridge's
       burst is spent and the valve closes until the fingers open. */
    function flow(tr, t, dt){
      /* What is already flying moves on... */
      for(const q of tr.stream){
        if(!q) continue;
        q.p[0] += q.v[0] * dt; q.p[1] += q.v[1] * dt; q.p[2] += q.v[2] * dt;
        q.v[1] += STREAM.GRAVITY * q.ppm * dt;
      }
      const open = tr.trig.pressed && tr.fore && t - tr.seen < LOST_MS && (t - tr.openSince) / 1000 < STREAM.MAX_HOLD_S;
      tr.nozzleNow = null;
      if(open){
        /* ...and what left the nozzle during this frame has flown only since
           it left (at 8 m/s a whole frame is a metre). */
        const f = tr.fore, n = MODEL.NOZZLE;
        const p = inVideo(f, n[0] - MODEL.WRIST_X, n[1] + MODEL.LIFT_Y, n[2]);
        const v = f.along.map(x => x * STREAM.SPEED_MPS * f.ppm), g = STREAM.GRAVITY * f.ppm;
        const per = 1 / STREAM.EMIT_HZ;
        tr.emitAcc += dt;
        while(tr.emitAcc >= per){
          tr.emitAcc -= per;
          const age = tr.emitAcc;
          tr.stream.push({ p: [p[0] + v[0] * age, p[1] + v[1] * age + 0.5 * g * age * age, p[2] + v[2] * age], v: [v[0], v[1] + g * age, v[2]],
                           born: t - age * 1000, k: tr.emitN++, ppm: f.ppm, vw: tr.vw, vh: tr.vh });
        }
        tr.nozzleNow = { p, k: tr.emitN + tr.emitAcc * STREAM.EMIT_HZ, ppm: f.ppm, vw: tr.vw, vh: tr.vh, born: t };
        tr.stream.cut = false;
      } else if(tr.stream.length && !tr.stream.cut){
        tr.stream.cut = true;
        tr.stream.push(null);          // a break: what flies now is no longer joined to the nozzle
      }
      while(tr.stream.length && (!tr.stream[0] || (t - tr.stream[0].born) / 1000 > STREAM.LIFE_S)) tr.stream.shift();
    }
    function drawStreams(){
      const g = fx.getContext('2d');
      const dpr = root.devicePixelRatio || 1;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const t = now();
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.shadowColor = 'rgba(255,255,255,0.6)'; g.shadowBlur = 4;
      for(const tr of tracks){
        /* Runs of joined fluid, split where the valve closed; while it is
           open the newest run is still joined to the nozzle. */
        let run = [];
        const runs = [];
        for(const q of tr.stream){ if(!q){ if(run.length > 1) runs.push(run); run = []; } else run.push(q); }
        if(tr.nozzleNow) run.push(tr.nozzleNow);
        if(run.length > 1) runs.push(run);
        for(const r of runs) drawRun(g, r, t);
      }
    }
    function drawRun(g, r, t){
      const cv = cover(r[0].vw, r[0].vh);
      /* The fluid's bits are SPEED/EMIT_HZ apart (6.7 cm at 8 m/s); drawn
         every few pixels between them, so the twist is not aliased. */
      const P = [];
      for(let i = 0; i < r.length; i++){
        const a = r[i], b = r[i + 1];
        const A = [cv.ox + a.p[0] * cv.sc, cv.oy + a.p[1] * cv.sc];
        if(!b){ P.push({ x: A[0], y: A[1], k: a.k, ppm: a.ppm }); break; }
        const B = [cv.ox + b.p[0] * cv.sc, cv.oy + b.p[1] * cv.sc];
        const n = Math.max(1, Math.min(32, Math.ceil(Math.hypot(B[0] - A[0], B[1] - A[1]) / 3)));
        for(let j = 0; j < n; j++){ const u = j / n; P.push({ x: A[0] + (B[0] - A[0]) * u, y: A[1] + (B[1] - A[1]) * u, k: a.k + (b.k - a.k) * u, ppm: a.ppm }); }
      }
      if(P.length < 2) return;
      /* Two fine threads twisted round the core, as the fluid leaves the
         nozzle: a turn every PITCH_M of travel. */
      const turn = (STREAM.SPEED_MPS / STREAM.EMIT_HZ) / STREAM.PITCH_M * Math.PI * 2;
      for(const ph of [0, Math.PI]){
        g.beginPath();
        for(let i = 0; i < P.length; i++){
          const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
          let nx = -(b.y - a.y), ny = b.x - a.x;
          const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
          const amp = STREAM.TWIST_M * P[i].ppm * cv.sc;
          const s = Math.sin(P[i].k * turn + ph) * amp;
          const x = P[i].x + nx * s, y = P[i].y + ny * s;
          if(i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        const age = Math.min(1, (t - r[r.length - 1].born) / 1000 / STREAM.LIFE_S);
        g.strokeStyle = 'rgba(255,255,255,' + (0.92 * (1 - age * 0.7)).toFixed(3) + ')';
        g.lineWidth = 1.3;
        g.stroke();
      }
      g.beginPath();
      P.forEach((p, i) => { if(i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y); });
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 0.8; g.stroke();
    }

    /* What a learner wants to see: which forearm source, the trigger's two
       angles, the valve. */
    function readout(){
      return { pose: poseState, hands: tracks.filter(tr => tr.frame && now() - tr.seen < LOST_MS).map(tr => ({
        side: tr.right ? 'R' : 'L', forearm: tr.source,
        middle: tr.bends ? Math.round(tr.bends.middle) : null, ring: tr.bends ? Math.round(tr.bends.ring) : null,
        valve: tr.trig.pressed ? 'open' : 'closed', flowS: tr.trig.pressed ? Math.round((now() - tr.openSince) / 100) / 10 : 0,
        bendDeg: tr.fore ? Math.round(angleDeg(tr.fore.along, tr.frame.along)) : 0 })) };
    }

    function show(on){
      active = !!on;
      glCanvas.classList.toggle('on', active);
      fx.classList.toggle('on', active);
      if(active){ lastDraw = 0; if(!raf) raf = root.requestAnimationFrame(draw); }
      else {
        if(raf){ root.cancelAnimationFrame(raf); raf = 0; }
        for(const tr of tracks){ [tr.arm, tr.hand, tr.wire].forEach(g => scene && scene.remove(g)); if(tr.wire.geometry) tr.wire.geometry.dispose(); }
        tracks.length = 0;
        try{ fx.getContext('2d').clearRect(0, 0, fx.width, fx.height); }catch(e){}
        try{ if(renderer) renderer.clear(); }catch(e){}
      }
    }

    return {
      load, update, show, setMirrored,
      get active(){ return active; },
      stats(){
        return { active, shots, frames, loaded: !!model, triangles: drawn, pose: poseState,
                 hands: tracks.map(tr => ({ id: tr.id, right: tr.right, visible: tr.arm.visible, source: tr.source,
                   valve: tr.trig.pressed, stream: tr.stream.filter(Boolean).length,
                   sample: tr.stream.filter(Boolean).slice(-3).map(q => q.p.map(Math.round)),
                   frame: tr.frame && { origin: tr.frame.origin, along: tr.frame.along, normal: tr.frame.normal, ppm: tr.frame.ppm },
                   forearm: tr.fore && tr.fore.along })) };
      },
      readout
    };
  }

  root.JarvisWebShooter = { create, thwipPose, TriggerState, handFrame, forearmFrame, inVideo, forearmFromPose, forearmFromPixels,
                            skinModel, lift2d, chooseForearm, MODEL, THWIP, STREAM, POSE, SKIN, PALM_M, MAX_BEND_DEG };
})(typeof window !== 'undefined' ? window : globalThis);
