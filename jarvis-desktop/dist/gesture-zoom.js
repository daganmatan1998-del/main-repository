/* =====================================================================
   JARVIS GESTURE ZOOM — two hands, two pinches, stretch to zoom.

   Loaded by camera.html, the one window that owns the camera stream (two
   webviews cannot share a MediaStream, so hand tracking has to live where
   the pictures are). The pipeline, one stage per section below:

     HAND TRACKING      MediaPipe HandLandmarker, vendored, run locally
       -> PINCH         per hand: thumb tip to index tip, over palm length,
                        with hysteresis, a fist guard and debouncing
       -> DISTANCE      between the two pinch points, over hand size, so
                        leaning toward the camera is not a zoom
       -> SMOOTHING     One Euro filter, dead zone, slew limit, easing
       -> GESTURE       idle -> arming (fresh baseline) -> armed -> zooming,
                        ended the moment either hand lets go
       -> FOREGROUND    Rust's zoom_target: which window, which program
       -> ADAPTER       browser / document / image / 3D / our own viewer /
                        generic, chosen from the program, never hard-coded
       -> CONTENT ZOOM  Rust's zoom_send (the OS input that program reads
                        as zoom), or straight into our own 3D viewer

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
    sensitivity: 1.0,   // multiplier on how much zoom a stretch buys
    threshold: 8,       // % change in hand distance before anything moves
    smoothing: 0.5,     // 0 = raw and quick, 1 = very smooth and a little late
    maxSpeed: 3,        // the zoom can change by at most this factor per second
    maxZoom: 5,         // 500 %, relative to where JARVIS first found the window
    minZoom: 0.25       // 25 %
  });
  const LIMITS = {
    sensitivity: [0.25, 3], threshold: [2, 30], smoothing: [0, 1],
    maxSpeed: [1.2, 10], maxZoom: [1.2, 20], minZoom: [0.05, 0.9]
  };
  const STORE_KEY = 'jarvis_store:gesture_zoom';

  function normaliseSettings(s){
    const out = Object.assign({}, DEFAULTS);
    if(s && typeof s === 'object'){
      if(typeof s.enabled === 'boolean') out.enabled = s.enabled;
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
     ONE HAND — measured in units of its own palm (wrist to the middle
     finger's knuckle), so the numbers mean the same near the camera and
     far from it. Measured on real MediaPipe landmarks:
       OK sign (a real pinch)   pinch 0.14-0.17
       relaxed open hands       0.38-0.46
       open / pointing          1.0 and up
       a FIST                   0.20 — which is why the fist guard exists:
     in a pinch the index tip is away from its own knuckle and the thumb
     tip away from the index knuckle (0.52-0.68 on the OK signs); a fist
     folds both in (0.16-0.19).
  ------------------------------------------------------------------ */
  const PINCH_ON = 0.30, PINCH_OFF = 0.42, FIST_GUARD = 0.33;

  function handMetrics(landmarks, width, height){
    if(!landmarks || landmarks.length < 21) return null;
    const P = (i) => ({ x: landmarks[i].x * width, y: landmarks[i].y * height });
    const wrist = P(0), thumbTip = P(4), indexMcp = P(5), indexTip = P(8), middleMcp = P(9);
    const scale = dist(wrist, middleMcp);
    if(!(scale > 1)) return null;
    return {
      scale,
      pinch: dist(thumbTip, indexTip) / scale,
      indexReach: dist(indexTip, indexMcp) / scale,
      thumbReach: dist(thumbTip, indexMcp) / scale,
      point: { x: (thumbTip.x + indexTip.x) / 2, y: (thumbTip.y + indexTip.y) / 2 }
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
     THE GESTURE.

     Both hands pinched -> ARMING: ~150 ms of samples become the baseline
     (their median, so one bad frame cannot set it). Nothing zooms yet.
     ARMED: waiting for a real stretch — the hands must move past the dead
     zone (8 % by default) before ZOOMING begins, and the dead zone is
     subtracted, so crossing it starts from zero instead of jumping.

     It is POSITION control, like a touch screen: the zoom follows the
     ratio of the current distance to the baseline — 250/200 a little,
     350/200 more, 500/200 a lot — and bringing the hands back to where
     they started brings the zoom back too. What reaches the application
     ("applied") eases toward that target and never faster than maxSpeed.

     Either hand letting go ends it at once; the next pinch builds a new
     baseline from scratch.
  ------------------------------------------------------------------ */
  const GAIN = 1.5, ARM_MS = 150;

  class TwoHandZoom {
    constructor(settings){
      this.pins = [new PinchState(), new PinchState()];
      this.slots = [null, null];          // last pinch point per slot, to keep hands apart
      this.configure(settings);
      this.limits = [-Infinity, Infinity];
      this.resetGesture();
    }
    configure(settings){
      this.s = normaliseSettings(settings);
      this.filter = new OneEuro(lerp(3.0, 0.5, this.s.smoothing), 0.08, 1.0);
    }
    setLimits(lo, hi){ this.limits = [lo, hi]; }
    resetGesture(){
      this.state = 'idle'; this.samples = []; this.baseline = null; this.armStart = 0;
      this.target = 0; this.applied = 0; this.lastT = null; this.lastD = null; this.lr = 0;
      if(this.filter) this.filter.reset();
    }

    /* Two hands to two slots: by x when both are seen, by nearness to the
       last known slot when one is. */
    assign(ms){
      const out = [null, null];
      if(ms.length >= 2){
        const two = ms.slice(0, 2).sort((a, b) => a.point.x - b.point.x);
        out[0] = two[0]; out[1] = two[1];
      } else if(ms.length === 1){
        const m = ms[0];
        const d0 = this.slots[0] ? dist(m.point, this.slots[0]) : Infinity;
        const d1 = this.slots[1] ? dist(m.point, this.slots[1]) : Infinity;
        out[d0 <= d1 ? 0 : 1] = m;
      }
      for(let i = 0; i < 2; i++) if(out[i]) this.slots[i] = out[i].point;
      return out;
    }

    /* frame = { t (ms), hands: [{ landmarks }], width, height }.
       Returns what happened: { type: 'none'|'start'|'move'|'end'|'cancel', ... } */
    update(frame){
      const t = frame.t;
      const ms = (frame.hands || []).map(h => handMetrics(h.landmarks || h, frame.width, frame.height)).filter(Boolean);
      const slot = this.assign(ms);
      const e0 = this.pins[0].update(slot[0], t), e1 = this.pins[1].update(slot[1], t);
      const a = this.pins[0].last, b = this.pins[1].last;
      const both = e0 && e1 && a && b;
      const base = { state: this.state, points: [a && a.point, b && b.point], engaged: [e0, e1] };

      if(!both){
        if(this.state === 'armed' || this.state === 'zooming'){
          const ev = Object.assign(base, { type: 'end', applied: this.applied, target: this.target });
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
          this.lastT = t;
          return Object.assign(base, { type: 'start', state: 'armed', baseline: this.baseline, distance: Ds });
        }
        return Object.assign(base, { type: 'none', state: 'arming', distance: Ds });
      }

      /* armed or zooming */
      const dz = Math.log(1 + this.s.threshold / 100);
      const lr = Math.log(Ds / this.baseline);
      this.lr = lr;
      if(this.state === 'armed' && Math.abs(lr) > dz) this.state = 'zooming';
      const raw = this.state === 'zooming' ? Math.sign(lr) * Math.max(0, Math.abs(lr) - dz) * GAIN * this.s.sensitivity : 0;
      this.target = clamp(raw, this.limits[0], this.limits[1]);

      const dt = clamp((t - (this.lastT === null ? t : this.lastT)) / 1000, 0, 0.25);
      this.lastT = t;
      const tau = lerp(0.05, 0.3, this.s.smoothing);
      const k = dt > 0 ? 1 - Math.exp(-dt / tau) : 0;
      const maxStep = Math.log(this.s.maxSpeed) * dt;
      this.applied += clamp((this.target - this.applied) * k, -maxStep, maxStep);

      return Object.assign(base, { type: 'move', state: this.state, baseline: this.baseline, distance: Ds,
                                   ratio: Ds / this.baseline, target: this.target, applied: this.applied });
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
      if((a.exe && a.exe.indexOf(exe) >= 0) || (a.cls && a.cls.indexOf(cls) >= 0)) return label(a);
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
     THE ZOOM MANAGER — from "the gesture wants this much zoom" to what
     the foreground program actually receives.

     The gesture's applied value is continuous; wheel notches and key
     presses are not. So the manager keeps what it has already sent, and
     sends another notch only when the gesture is at least 70 % of a notch
     ahead — which is also the hysteresis: after a notch in, the next
     notch out is 1.4 notches of hand movement away, so a hand held still
     at a boundary never makes the content twitch in and out.

     Our own 3D viewer gets the continuous value itself.

     The foreground is re-read at the start of every gesture and every
     half second during one, so switching programs mid-stretch hands the
     gesture to the new one without a jump. "Zoom level" is tracked per
     window from where JARVIS first found it, which is what the min/max
     zoom settings limit.
  ------------------------------------------------------------------ */
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
      this.active = false; this.target = null; this.adapter = null; this.sent = 0; this.offset = 0;
      this.busy = false; this.lastSendAt = 0; this.lastCheck = 0; this.checking = false; this.startLevel = 1;
      this.generation = (this.generation || 0) + 1;
    }
    keyOf(info){ return info ? String(info.hwnd) + '|' + (info.exe || '') : ''; }
    levelNow(){ return this.startLevel * Math.exp(this.sent - this.offset); }

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

    useTarget(info, applied){
      const adapter = selectAdapter(info);
      this.target = info; this.adapter = adapter;
      if(!adapter.supported){
        this.active = false;
        this.onStatus({ kind: 'unsupported', reason: adapter.reason || info.error || 'cannot zoom that' });
        return false;
      }
      this.active = true;
      this.startLevel = this.levels.get(this.keyOf(info)) || 1;
      /* From here, only what the hands do next counts for this window. */
      this.offset = applied || 0; this.sent = applied || 0;
      const s = this.settings;
      if(this.gesture) this.gesture.setLimits(Math.log(s.minZoom / this.startLevel) + this.offset,
                                              Math.log(s.maxZoom / this.startLevel) + this.offset);
      this.onStatus({ kind: 'target', adapter: adapter.id, method: adapter.method, name: adapter.name, app: adapter.app });
      return true;
    }

    async begin(){
      const gen = ++this.generation;
      this.reset(); this.generation = gen;
      const info = await this.readTarget();
      if(gen !== this.generation) return;           // released while we were looking
      this.lastCheck = this.now();
      this.useTarget(info, 0);
    }

    remember(){
      if(this.target && this.adapter && this.adapter.supported){
        this.levels.set(this.keyOf(this.target), this.levelNow());
      }
    }

    move(ev){
      const applied = ev.applied || 0;
      const now = this.now();
      /* Which window is in front, every half second, without holding the frame. */
      if(!this.checking && now - this.lastCheck > 500 && this.target !== null){
        this.checking = true; this.lastCheck = now;
        const gen = this.generation;
        this.readTarget().then(info => {
          this.checking = false;
          if(gen !== this.generation) return;
          if(this.keyOf(info) !== this.keyOf(this.target)){ this.remember(); this.useTarget(info, applied); }
        });
      }
      if(!this.active || !this.adapter) return;
      const a = this.adapter;

      if(a.method === 'direct'){
        const d = applied - this.sent;
        if(Math.abs(d) >= 0.002){
          this.sent = applied;
          this.emit('jarvis://model-zoom', { factor: Math.exp(d), level: this.levelNow() });
        }
        return;
      }

      if(this.busy) return;
      const stepLog = Math.log(a.step);
      const pending = applied - this.sent;
      if(Math.abs(pending) < 0.7 * stepLog) return;
      if(now - this.lastSendAt < 1000 / a.rate) return;
      const n = Math.sign(pending) * Math.min(2, Math.max(1, Math.round(Math.abs(pending) / stepLog)));
      this.busy = true;
      const gen = this.generation, target = this.target;
      this.invoke('zoom_send', { hwnd: target.hwnd, method: a.method, notches: n }).then(() => {
        if(gen !== this.generation) return;
        this.sent += n * stepLog;
        this.lastSendAt = this.now();
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
     THE OVERLAY — the two pinch points and the line between them, drawn
     over the camera picture, so he can see what JARVIS sees: grey open,
     cyan pinched, green zooming. Mapped through object-fit: cover, and
     mirrored with the picture.
  ------------------------------------------------------------------ */
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
      g.fillStyle = col; g.fillText(label, 14, 21);
      g.restore();
    }
  }

  /* ------------------------------------------------------------------
     THE CONTROLLER — camera frames in, zoom out. Detection runs about 30
     times a second while hands are in view and drops to about 9 when
     none have been for a second and a half, so an idle camera costs
     little. Nothing runs at all while the feature is off.
  ------------------------------------------------------------------ */
  function startGestureZoom(o){
    const video = o.video, overlay = o.overlay;
    const now = () => (root.performance && root.performance.now ? root.performance.now() : Date.now());
    let settings = normaliseSettings(o.settings);
    const gesture = new TwoHandZoom(settings);
    let label = '';
    const status = (s) => {
      if(s.kind === 'target') label = 'ZOOM · ' + (s.name || '');
      else if(s.kind === 'zoom') label = 'ZOOM · ' + (s.name || '') + ' ×' + s.level.toFixed(2);
      else if(s.kind === 'unsupported') label = 'NO ZOOM · ' + s.reason;
      else if(s.kind === 'error') label = 'ZOOM FAILED · ' + s.reason;
      else if(s.kind === 'idle') label = '';
      if(o.onStatus) o.onStatus(s);
    };
    const manager = new ZoomManager({ invoke: o.invoke, emit: o.emit, gesture, settings, onStatus: status });
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
    function schedule(){
      if(!running) return;
      const idle = now() - handsAt > 1500;
      timer = setTimeout(tick, idle ? 110 : 30);
    }
    function tick(){
      timer = null;
      if(!running) return;
      try{
        if(tracker && video.readyState >= 2 && video.videoWidth){
          const t = now();
          const hands = tracker.detect(video, t);
          const t2 = now();
          frames++; spent += t2 - t;
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
          drawOverlay(overlay, video, ev, label || (ev.state === 'armed' ? 'ZOOM · READY' : ''));
        }
      }catch(e){ if(o.onStatus) o.onStatus({ kind: 'error', reason: String((e && e.message) || e) }); }
      schedule();
    }
    const api = {
      gesture, manager,
      start(){
        if(running || !settings.enabled) return Promise.resolve(false);
        running = true;
        return ensureTracker().then(() => { if(running && !timer) schedule(); return true; }, () => { running = false; return false; });
      },
      stop(){
        running = false;
        if(timer){ clearTimeout(timer); timer = null; }
        if(gesture.state !== 'idle'){ manager.handle({ type: 'end' }); gesture.resetGesture(); }
        drawOverlay(overlay, video, null, '');
      },
      configure(s){
        settings = normaliseSettings(s);
        gesture.configure(settings); manager.configure(settings);
        if(settings.enabled) api.start(); else api.stop();
      },
      stats(){ return { frames, avgMs: frames ? spent / frames : 0, running, delegate: tracker && tracker.delegate, switched, last: lastEv }; }
    };
    return api;
  }

  root.JarvisGestureZoom = {
    DEFAULTS, LIMITS, STORE_KEY, normaliseSettings, OneEuro, handMetrics, PinchState, TwoHandZoom,
    ADAPTERS, selectAdapter, ZoomManager, createTracker, drawOverlay, startGestureZoom,
    constants: { PINCH_ON, PINCH_OFF, FIST_GUARD, GAIN, ARM_MS }
  };
})(typeof window !== 'undefined' ? window : globalThis);
