/* ------------------------------------------------------------------
   WEB SHOOTERS (2.25.0) — the WS-01 web shooter on his wrists, in the
   camera window, and a web when he folds the middle and ring fingers.

   "Activate web shooter" puts the model (filters/ws-01-web-shooter.glb,
   his own file) on every hand the tracker sees; "take down the web
   shooters" takes them off. While they are on, the camera controls
   nothing on the computer (gesture-zoom's setFilter): this file is given
   each read of the hands instead.

   THE MODEL, measured from the file (metres): X runs along the forearm
   toward the fingers (the nozzle at x 0.153, the palm trigger at 0.23-0.26,
   in the palm under the middle and ring knuckles), Y comes out of the skin
   (it sits on the INNER wrist, the palm side), Z points to the thumb (the
   radial rail). That is a right arm; the left one is its mirror image.

   THE HAND, from the tracker: wrist (0), the middle knuckle (9) gives
   "along", pinky knuckle (17) to index knuckle (5) gives "across" (toward
   the thumb), and "out of the palm" is their cross product, whose sign is
   the hand: the tracker's own label, which on an unmirrored picture is the
   real hand (measured: two right hands in MediaPipe's right_hands.jpg read
   "Right"). Size: the palm, wrist to the knuckles, against an adult's
   9.2 cm. The forearm and palm are drawn as invisible depth (occluders),
   so a shooter on the far side of the wrist is hidden behind it, as it
   would be.

   THE WEB: middle and ring folded (bent past 80°), index and pinky out —
   the "thwip" — fires once; it fires again only after those fingers open.
   It leaves the nozzle where the palm faces (a little toward the fingers)
   as two white threads twisted round each other, and splats where it
   lands: across the picture when he aims to the side, big and close when
   he aims at the camera.
------------------------------------------------------------------ */
(function(root){
  'use strict';
  const GZ = root.JarvisGestureZoom;

  const MODEL = { WRIST_X: 0.16, LIFT_Y: 0.027, NOZZLE: [0.1536, 0.013, 0.006] };
  const PALM_M = 0.092;            // wrist to the middle knuckle on an adult hand, metres
  const THWIP = { FOLD_ON: 80, FOLD_OFF: 50, OUT_MAX: 55, PINKY_MAX: 70, FRAMES: 2, REARM_FRAMES: 2 };
  const LOST_MS = 260;             // a hand unseen this long is put away
  const WEB = { TRAVEL_MS: 170, SPLAT_MS: 130, HOLD_MS: 820, FADE_MS: 480 };

  /* --- the pose -------------------------------------------------- */
  function thwipPose(m){
    if(!m || !m.bends) return 'off';
    const b = m.bends;
    if(b.middle >= THWIP.FOLD_ON && b.ring >= THWIP.FOLD_ON && b.index <= THWIP.OUT_MAX && b.pinky <= THWIP.PINKY_MAX) return 'on';
    if(b.middle < THWIP.FOLD_OFF || b.ring < THWIP.FOLD_OFF) return 'off';
    return 'between';
  }
  /* Once per fold: two frames of the pose fire it, two frames with the
     fingers open again re-arm it; anything between does neither. */
  class ThwipTrigger {
    constructor(){ this.onRun = 0; this.offRun = 0; this.fired = false; }
    update(m){
      const p = thwipPose(m);
      if(p === 'on'){
        this.offRun = 0;
        if(!this.fired && ++this.onRun >= THWIP.FRAMES){ this.fired = true; this.onRun = 0; return true; }
      } else if(p === 'off'){
        this.onRun = 0;
        if(this.fired && ++this.offRun >= THWIP.REARM_FRAMES){ this.fired = false; this.offRun = 0; }
      } else this.onRun = 0;
      return false;
    }
  }

  /* --- the hand's own frame, in video pixels (x right, y down, z away
         from the camera, on x's scale) ------------------------------- */
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a) => Math.sqrt(dot(a, a));
  const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const orth = (a, n) => { const k = dot(a, n); return [a[0] - n[0] * k, a[1] - n[1] * k, a[2] - n[2] * k]; };

  function handFrame(L, vw, vh, right){
    if(!L || L.length < 21) return null;
    const P = L.map(p => [p.x * vw, p.y * vh, (Number(p.z) || 0) * vw]);
    const along = unit(sub(P[9], P[0]));
    const across = unit(orth(sub(P[5], P[17]), along));
    const normal = right ? cross(across, along) : cross(along, across);   // out of the palm
    const palm = (len(sub(P[5], P[0])) + len(sub(P[9], P[0])) + len(sub(P[13], P[0])) + len(sub(P[17], P[0]))) / 4 * 1.03;
    if(!(palm > 4)) return null;
    return { origin: P[0], along, across, normal, right, ppm: palm / PALM_M };
  }
  /* A point given in the hand's frame (metres) back in video pixels. */
  function inVideo(f, x, y, z){
    return [0, 1, 2].map(i => f.origin[i] + (f.along[i] * x + f.normal[i] * y + f.across[i] * z) * f.ppm);
  }
  /* Where the web goes: out of the palm, a little toward the fingers. */
  function shotDirection(f){
    return unit([0, 1, 2].map(i => f.normal[i] + f.along[i] * 0.35));
  }

  /* --- the filter ------------------------------------------------- */
  function create(o){
    const THREE = root.THREE;
    const stage = o.stage, video = o.video;
    const mk = (id) => { const c = root.document.createElement('canvas'); c.id = id; stage.appendChild(c); return c; };
    const glCanvas = mk('ws3d'), fx = mk('wsfx');
    let renderer = null, scene = null, camera = null, model = null, raf = 0, active = false, mirrored = !!(o.mirrored && o.mirrored());
    const tracks = [];               // { id, label vote, filters, frame, seen, trig, group }
    const webs = [];
    let nextId = 1, lastFrame = null, shots = 0, frames = 0, W = 0, H = 0, drawn = 0;

    function setMirrored(m){
      mirrored = !!m;
      glCanvas.classList.toggle('mirrored', mirrored);
      fx.classList.toggle('mirrored', mirrored);
    }
    setMirrored(mirrored);

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
      return new Promise((resolve, reject) => {
        new THREE.GLTFLoader().load(url, (gltf) => { model = gltf.scene; resolve(true); },
                                    undefined, (err) => reject(new Error('the web shooter model would not load: ' + ((err && err.message) || err))));
      });
    }

    /* One hand's group: the model where it is worn, and the arm and palm as
       depth only, so what is behind them is hidden. */
    function makeGroup(){
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      const ws = model.clone(true);
      ws.position.set(-MODEL.WRIST_X, MODEL.LIFT_Y, 0);
      g.add(ws);
      const hide = new THREE.MeshBasicMaterial({ colorWrite: false });
      const arm = new THREE.CylinderGeometry(1, 1, 1, 28, 1, false);
      arm.rotateZ(-Math.PI / 2);
      arm.scale(0.27, 0.021, 0.031);
      arm.translate(-0.12, 0, 0);
      /* To just past the knuckles: shorter, and the palm trigger's edge showed
         across the back of the hand. */
      const palm = new THREE.BoxGeometry(0.125, 0.028, 0.092);
      palm.translate(0.0575, 0, 0);
      [arm, palm].forEach(geo => { const m = new THREE.Mesh(geo, hide); m.renderOrder = -1; g.add(m); });
      g.visible = false;
      scene.add(g);
      return g;
    }

    function filtersFor(){
      const mk1 = (mc, b) => new GZ.OneEuro(mc, b, 1);
      return { o: [mk1(1.2, 0.02), mk1(1.2, 0.02), mk1(1.2, 0.02)],
               a: [mk1(1.5, 0.6), mk1(1.5, 0.6), mk1(1.5, 0.6)],
               c: [mk1(1.5, 0.6), mk1(1.5, 0.6), mk1(1.5, 0.6)],
               s: mk1(1.0, 0.005) };
    }

    /* Each read of the hands (from the tracker, a few dozen a second). */
    function update(frame){
      if(!active || !model || !frame) return;
      frames++;
      lastFrame = frame;
      const vw = frame.width, vh = frame.height, t = frame.t;
      const seen = new Set();
      for(const h of (frame.hands || [])){
        const L = h.landmarks;
        if(!L || L.length < 21) continue;
        const wx = L[0].x * vw, wy = L[0].y * vh;
        /* The same hand as last time: the nearest one still about. */
        let tr = null, best = 0.25 * vw;
        for(const c of tracks){
          if(seen.has(c) || !c.frame) continue;
          const d = Math.hypot(c.frame.origin[0] - wx, c.frame.origin[1] - wy);
          if(d < best){ best = d; tr = c; }
        }
        if(!tr){
          if(tracks.length >= 2) continue;
          tr = { id: nextId++, vote: 0, f: filtersFor(), frame: null, seen: 0, trig: new ThwipTrigger(), group: makeGroup() };
          tracks.push(tr);
        }
        seen.add(tr);
        /* Right or left, steadied: the label is voted over a few frames and
           changes side only past a margin, so one misread frame does not
           flip the shooter over. */
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
        tr.frame = { origin: fo, along: fa, across: fc, normal: tr.right ? cross(fc, fa) : cross(fa, fc), right: tr.right, ppm: tr.f.s.filter(raw.ppm, t) };
        tr.seen = t;
        tr.vw = vw; tr.vh = vh;
        const m = GZ && GZ.handMetrics ? GZ.handMetrics(L, vw, vh) : null;
        if(tr.trig.update(m)) fire(tr);
      }
    }

    /* Video pixels to the canvas (object-fit: cover), and to the 3D world
       (y up, z toward the viewer). */
    function cover(vw, vh){
      const sc = Math.max(W / vw, H / vh);
      return { sc, ox: (W - vw * sc) / 2, oy: (H - vh * sc) / 2 };
    }
    function toCanvas(p, cv){ return { x: cv.ox + p[0] * cv.sc, y: cv.oy + p[1] * cv.sc }; }

    function fire(tr){
      const f = tr.frame;
      if(!f) return;
      const n = MODEL.NOZZLE;
      const start = inVideo(f, n[0] - MODEL.WRIST_X, n[1] + MODEL.LIFT_Y, n[2]);
      const d = shotDirection(f);
      shots++;
      webs.push({ t0: now(), start, d, vw: tr.vw, vh: tr.vh, seed: Math.random() * 1000, hand: f.right ? 'right' : 'left' });
      if(o.onShot) try{ o.onShot({ hand: f.right ? 'right' : 'left', toward: -d[2] }); }catch(e){}
    }

    const now = () => (root.performance && root.performance.now ? root.performance.now() : Date.now());

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

    const M = () => new THREE.Matrix4();
    function draw(){
      raf = 0;
      if(!active) return;
      resize();
      const t = now();
      for(const tr of tracks){
        const visible = tr.frame && t - tr.seen < LOST_MS && tr.vw;
        tr.group.visible = !!visible;
        if(!visible) continue;
        const f = tr.frame, cv = cover(tr.vw, tr.vh);
        const w = (v) => new THREE.Vector3(v[0], -v[1], -v[2]);            // a direction, video -> world
        const pos = new THREE.Vector3(cv.ox + f.origin[0] * cv.sc, -(cv.oy + f.origin[1] * cv.sc), -f.origin[2] * cv.sc);
        const basis = M().makeBasis(w(f.along), w(f.normal), w(f.across));  // X along, Y out of the palm, Z to the thumb
        const s = f.ppm * cv.sc;
        tr.group.matrix.copy(basis).scale(new THREE.Vector3(s, s, s)).setPosition(pos);
        tr.group.matrixWorldNeedsUpdate = true;
      }
      /* A hand gone for good is forgotten (and its group freed). */
      for(let i = tracks.length - 1; i >= 0; i--){
        if(t - tracks[i].seen > 1500){ scene.remove(tracks[i].group); tracks.splice(i, 1); }
      }
      renderer.render(scene, camera);
      drawn = renderer.info.render.triangles;
      drawWebs(t);
      raf = root.requestAnimationFrame(draw);
    }

    /* --- the webs, in canvas pixels -------------------------------- */
    function rnd(seed){ let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
    function drawWebs(t){
      const g = fx.getContext('2d');
      const dpr = root.devicePixelRatio || 1;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const life = WEB.TRAVEL_MS + WEB.HOLD_MS + WEB.FADE_MS;
      for(let i = webs.length - 1; i >= 0; i--) if(t - webs[i].t0 > life) webs.splice(i, 1);
      for(const web of webs) drawWeb(g, web, t - web.t0);
    }
    function drawWeb(g, web, age){
      const cv = cover(web.vw, web.vh);
      const S = toCanvas(web.start, cv);
      const toward = Math.max(0, -web.d[2]);                 // video z is away from the camera
      let ux = web.d[0], uy = web.d[1];
      const lateral = Math.hypot(ux, uy);
      if(lateral < 1e-3){ ux = 0; uy = -1; } else { ux /= lateral; uy /= lateral; }
      const diag = Math.hypot(W, H);
      /* Aimed at the camera, it lands in front of the hand (and big); aimed
         to the side, it crosses the picture. */
      const Lfull = Math.max(0.06 * diag, lateral * diag * 1.15 * (1 - 0.6 * toward));
      const head = Math.min(1, age / WEB.TRAVEL_MS);
      const reach = Lfull * (1 - Math.pow(1 - head, 3));
      const alpha = age < WEB.TRAVEL_MS + WEB.HOLD_MS ? 1 : Math.max(0, 1 - (age - WEB.TRAVEL_MS - WEB.HOLD_MS) / WEB.FADE_MS);
      if(alpha <= 0) return;
      const nx = -uy, ny = ux;
      const wob = age * 0.012;
      g.save();
      g.globalAlpha = alpha;
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.shadowColor = 'rgba(255,255,255,0.75)'; g.shadowBlur = 7;
      /* Two threads twisted round each other, wider as they come closer. */
      const steps = Math.max(24, Math.round(reach / 5));
      for(const ph of [0, Math.PI]){
        g.beginPath();
        for(let k = 0; k <= steps; k++){
          const q = k / steps, dist = q * reach;
          const persp = 1 + 2.6 * toward * (dist / Lfull);
          const amp = (2.2 + 4.5 * q) * persp;
          const off = amp * Math.sin(dist / (24 * persp) * Math.PI * 2 + ph + wob);
          const x = S.x + ux * dist + nx * off, y = S.y + uy * dist + ny * off;
          if(k === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.strokeStyle = 'rgba(255,255,255,0.95)';
        g.lineWidth = 1.3 + 1.6 * toward;
        g.stroke();
      }
      /* A faint straight core, so it reads as one strand from afar. */
      g.beginPath(); g.moveTo(S.x, S.y); g.lineTo(S.x + ux * reach, S.y + uy * reach);
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 0.8; g.stroke();
      /* The puff at the nozzle. */
      if(age < 140){
        g.beginPath(); g.arc(S.x, S.y, 4 + age / 14, 0, Math.PI * 2);
        g.fillStyle = 'rgba(255,255,255,' + (0.8 * (1 - age / 140)) + ')'; g.fill();
      }
      /* Where it lands: a web, big and close when aimed at the camera. */
      if(head >= 1){
        const grow = Math.min(1, (age - WEB.TRAVEL_MS) / WEB.SPLAT_MS);
        const R = Math.min(W, H) * (0.09 + 0.5 * toward) * (0.55 + 0.45 * grow);
        const E = { x: S.x + ux * Lfull, y: S.y + uy * Lfull };
        drawSplat(g, E, R, web.seed, toward, wob);
      }
      g.restore();
    }
    function drawSplat(g, E, R, seed, toward, wob){
      const r = rnd(Math.floor(seed));
      const K = 8, base = r() * Math.PI * 2;
      const ang = [];
      for(let k = 0; k < K; k++) ang.push(base + k * Math.PI * 2 / K + (r() - 0.5) * 0.35);
      const w = 1.1 + 1.4 * toward;
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      /* Spokes, each a little curly. */
      for(const a of ang){
        const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
        g.beginPath();
        for(let k = 0; k <= 18; k++){
          const q = k / 18, d = q * R, off = (1.5 + 2 * q) * Math.sin(q * 9 + a * 3 + wob);
          const x = E.x + ux * d + nx * off, y = E.y + uy * d + ny * off;
          if(k === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.lineWidth = w; g.stroke();
      }
      /* Rings sagging toward the middle between the spokes. */
      for(const f of [0.32, 0.62, 0.92]){
        g.beginPath();
        for(let k = 0; k <= K; k++){
          const a0 = ang[k % K], a1 = ang[(k + 1) % K] + (k + 1 === K ? Math.PI * 2 : 0);
          const p0 = { x: E.x + Math.cos(a0) * R * f, y: E.y + Math.sin(a0) * R * f };
          const p1 = { x: E.x + Math.cos(a1) * R * f, y: E.y + Math.sin(a1) * R * f };
          const mid = (a0 + a1) / 2, sag = R * f * 0.8;
          if(k === 0) g.moveTo(p0.x, p0.y);
          if(k < K) g.quadraticCurveTo(E.x + Math.cos(mid) * sag, E.y + Math.sin(mid) * sag, p1.x, p1.y);
        }
        g.lineWidth = w * 0.8; g.stroke();
      }
    }

    function show(on){
      active = !!on;
      glCanvas.classList.toggle('on', active);
      fx.classList.toggle('on', active);
      if(active){ if(!raf) raf = root.requestAnimationFrame(draw); }
      else {
        if(raf){ root.cancelAnimationFrame(raf); raf = 0; }
        webs.length = 0;
        for(const tr of tracks) scene && scene.remove(tr.group);
        tracks.length = 0;
        try{ fx.getContext('2d').clearRect(0, 0, fx.width, fx.height); }catch(e){}
        try{ if(renderer){ renderer.clear(); } }catch(e){}
      }
    }

    return {
      load, update, show, setMirrored,
      get active(){ return active; },
      /* For the tests: what is on, where each shooter is, the webs in flight. */
      stats(){
        return { active, shots, frames, webs: webs.length, loaded: !!model, triangles: drawn,
                 hands: tracks.map(tr => ({ id: tr.id, right: tr.right, visible: tr.group.visible,
                   frame: tr.frame && { origin: tr.frame.origin, along: tr.frame.along, normal: tr.frame.normal, ppm: tr.frame.ppm } })) };
      },
      fireAll(){ tracks.forEach(fire); }
    };
  }

  root.JarvisWebShooter = { create, thwipPose, ThwipTrigger, handFrame, inVideo, shotDirection, MODEL, THWIP, PALM_M };
})(typeof window !== 'undefined' ? window : globalThis);
