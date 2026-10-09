import { createRng } from '../core/rng';
import { drawCastle, drawEnemy, enemyTop, roundRect, THEMES, type Theme } from './art';
import type { EnvironmentId } from './levels';
import { currentItem, type Enemy, type EnemyType, type GameEvent, type LevelState } from './levelState';
import { computeLayout, pointAt, type Field, type SceneLayout } from './path';

type Ctx = CanvasRenderingContext2D;

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; kind: 'spark' | 'star' | 'dust' | 'ring' | 'confetti'; rot?: number }
interface Projectile { fx: number; fy: number; enemyId: number; t: number; dur: number; color: string; onHit: () => void }
interface Dying { type: EnemyType; x: number; y: number; t: number; facing: 1 | -1 }
interface Floater { text: string; x: number; y: number; t: number; color: string; size: number }

export interface RenderOptions {
  walls: string;
  banner: string;
  magic: string;
  reducedMotion: boolean;
  bigText: boolean;
  lang: 'en' | 'he';
  /** Word shown in the boss announcement ("BOSS"). */
  bossLabel: string;
}

/**
 * Draws the battlefield. Reads LevelState, never changes it. Effects
 * (projectiles, bursts, floating text) live here, so the simulation stays
 * pure and testable.
 */
export class SceneRenderer {
  private ctx: Ctx;
  private bg: HTMLCanvasElement | null = null;
  private layout!: SceneLayout;
  private theme: Theme = THEMES.meadow;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private t = 0;
  private particles: Particle[] = [];
  private ambient: Particle[] = [];
  private projectiles: Projectile[] = [];
  private dying: Dying[] = [];
  private floaters: Floater[] = [];
  private confused = new Map<number, number>();
  private hurt = new Map<number, number>();
  private hidden = new Set<number>();
  private shake = 0;
  private castleFlash = 0;
  private field: Field = { x: 0, y: 0, w: 0, h: 0 };
  private rtl = false;
  orb = { x: 0, y: 0 };

  constructor(private canvas: HTMLCanvasElement, private opts: RenderOptions) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    this.ctx = ctx;
  }

  setOptions(o: Partial<RenderOptions>): void { Object.assign(this.opts, o); }

  setScene(env: EnvironmentId, rtl: boolean): void {
    this.theme = THEMES[env];
    this.rtl = rtl;
    this.bg = null;
    this.ambient = [];
  }

  /** field: the part of the canvas not covered by HUD and reading panel. */
  resize(field: Field): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.field = field;
    this.layout = computeLayout(field, this.rtl, this.h > this.w * 1.05);
    this.bg = null;
  }

  get sceneLayout(): SceneLayout { return this.layout; }

  /* ----------------------------------------------------------- events */

  enemyPos(e: Enemy): { x: number; y: number; facing: 1 | -1 } {
    const p = pointAt(this.layout, e.progress);
    // Two lanes so neighbours do not overlap.
    const lane = (e.spawnIndex % 2 === 0 ? -1 : 1) * this.layout.unit * 0.18;
    const len = Math.hypot(p.dx, p.dy) || 1;
    const nx = -p.dy / len, ny = p.dx / len;
    let facing: 1 | -1 = p.dx >= 0 ? 1 : -1;
    if (Math.abs(p.dx) < Math.abs(p.dy) * 0.3) facing = this.layout.gate.x >= p.x ? 1 : -1;
    return { x: p.x + nx * lane, y: p.y + ny * lane * 0.5, facing };
  }

  onEvents(events: GameEvent[], state: LevelState): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'spawn': {
          const p = this.enemyPos(ev.enemy);
          this.burst(p.x, p.y - this.layout.unit * 0.3, 10, '#ffffff', 'dust');
          break;
        }
        case 'defeat':
        case 'phase': {
          const e = ev.enemy;
          const pos = this.enemyPos(e);
          const final = ev.type === 'defeat';
          if (!final && e.type === 'boss') this.hurt.set(e.id, 1);
          if (final) this.hidden.add(e.id);
          this.fire(e.id, () => {
            const u = this.layout.unit;
            this.burst(pos.x, pos.y - u * 0.5, final ? 34 : 18, this.magicColor(), 'spark');
            this.burst(pos.x, pos.y - u * 0.5, 8, '#ffffff', 'ring');
            if (final) {
              this.dying.push({ type: e.type, x: pos.x, y: pos.y, t: 0, facing: pos.facing });
              this.burst(pos.x, pos.y - u * 0.6, 12, '#ffd166', 'star');
            }
            if (final && e.type === 'boss') {
              // The boss goes down in style: a big burst, confetti and a shake.
              this.burst(pos.x, pos.y - u, 60, this.magicColor(), 'spark');
              this.burst(pos.x, pos.y - u, 50, '#ffffff', 'confetti');
              this.burst(pos.x, pos.y - u, 20, '#ffd166', 'star');
              if (!this.opts.reducedMotion) this.shake = 0.5;
            }
            if (final && ev.type === 'defeat') this.floaters.push({ text: ev.firstTry ? '+150' : '+100', x: pos.x, y: pos.y - u * 1.4, t: 0, color: '#ffd166', size: u * 0.42 });
          });
          break;
        }
        case 'wrong':
          this.confused.set(ev.enemy.id, 1);
          break;
        case 'breach': {
          if (!ev.returns) this.hidden.add(ev.enemy.id);
          const g = this.layout.gate;
          this.burst(g.x, g.y - this.layout.unit * 0.4, 24, '#c8b6a6', 'dust');
          if (!this.opts.reducedMotion) this.shake = 0.35;
          this.castleFlash = 1;
          break;
        }
        case 'won': {
          const c = this.layout.castle;
          for (let i = 0; i < 4; i++) {
            setTimeout(() => this.burst(c.x + (Math.random() - 0.5) * this.w * 0.4, this.field.y + this.field.h * (0.2 + Math.random() * 0.3), 40, `hsl(${Math.random() * 360},90%,65%)`, 'confetti'), i * 250);
          }
          break;
        }
        default:
          break;
      }
    }
    void state;
  }

  private magicColor(): string {
    return this.opts.magic === 'rainbow' ? `hsl(${(this.t * 120) % 360},90%,65%)` : this.opts.magic;
  }

  private fire(enemyId: number, onHit: () => void): void {
    this.projectiles.push({ fx: this.orb.x, fy: this.orb.y, enemyId, t: 0, dur: this.opts.reducedMotion ? 0.15 : 0.38, color: this.magicColor(), onHit });
  }

  private burst(x: number, y: number, n: number, color: string, kind: Particle['kind']): void {
    const u = this.layout.unit;
    const count = this.opts.reducedMotion ? Math.ceil(n / 3) : n;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (kind === 'ring' ? 2.2 : 0.6 + Math.random() * 1.6) * u * (kind === 'confetti' ? 2.2 : 1.6);
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (kind === 'confetti' ? u * 1.5 : 0),
        life: 0, max: kind === 'ring' ? 0.35 : 0.5 + Math.random() * 0.6,
        size: (kind === 'star' ? 0.14 : kind === 'confetti' ? 0.1 : 0.06) * u * (0.6 + Math.random() * 0.8),
        color: kind === 'confetti' ? `hsl(${Math.random() * 360},90%,62%)` : color, kind, rot: Math.random() * 6,
      });
    }
  }

  /* --------------------------------------------------------- drawing */

  private buildBackground(): void {
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const ctx = c.getContext('2d')!;
    ctx.scale(this.dpr, this.dpr);
    const { w, h } = this;
    const th = this.theme;
    const rng = createRng(7 + w * 3 + h);

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, th.sky[0]); sky.addColorStop(0.55, th.sky[1]); sky.addColorStop(1, th.sky[2]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Sun with halo.
    const sx = this.rtl ? w * 0.18 : w * 0.82, sy = this.field.y + this.field.h * 0.12;
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.min(w, h) * 0.22);
    sg.addColorStop(0, th.sun); sg.addColorStop(0.25, th.sun); sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, w, h);

    const horizon = this.field.y + this.field.h * (this.layout.portrait ? 0.16 : 0.3);
    // Far mountains.
    const ridge = (base: number, amp: number, color: string, seed: number) => {
      const r = createRng(seed);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(0, base);
      let x = 0;
      while (x < w) {
        const step = w * (0.06 + r() * 0.08);
        ctx.lineTo(x + step / 2, base - amp * (0.4 + r() * 0.6));
        x += step;
        ctx.lineTo(x, base - amp * r() * 0.3);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    };
    ridge(horizon, h * 0.12, th.far, 11);
    ridge(horizon + h * 0.05, h * 0.07, th.mid, 23);

    // Ground.
    const groundTop = horizon + h * 0.05;
    const gg = ctx.createLinearGradient(0, groundTop, 0, h);
    gg.addColorStop(0, th.ground[0]); gg.addColorStop(1, th.ground[1]);
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.moveTo(0, groundTop + 10);
    for (let x = 0; x <= w; x += w / 8) ctx.quadraticCurveTo(x + w / 16, groundTop - 8 + rng() * 10, x + w / 8, groundTop + 6);
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();

    // Road: edge, body, stones.
    const path = this.layout.path;
    const u = this.layout.unit;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const stroke = (width: number, color: string) => {
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.beginPath(); path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
    };
    stroke(u * 1.15, th.roadEdge);
    stroke(u * 0.95, th.road);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    for (let i = 0; i < path.length; i += 3) {
      const p = path[i];
      ctx.beginPath(); ctx.ellipse(p.x + (rng() - 0.5) * u * 0.6, p.y + (rng() - 0.5) * u * 0.3, u * 0.06, u * 0.035, 0, 0, Math.PI * 2); ctx.fill();
    }

    // Decorations, kept off the road and away from the castle.
    const near = (x: number, y: number) => path.some((p) => Math.hypot(p.x - x, p.y - y) < u * 1.1) || Math.hypot(this.layout.castle.x - x, this.layout.castle.y - y) < u * 3;
    const decos: Array<{ x: number; y: number; s: number }> = [];
    for (let i = 0; i < 70 && decos.length < 22; i++) {
      const x = rng() * w, y = groundTop + 14 + rng() * (h - groundTop - 14);
      if (near(x, y) || y > this.field.y + this.field.h + u) continue;
      decos.push({ x, y, s: (0.5 + rng() * 0.6) * u * (0.6 + (y - groundTop) / h) });
    }
    decos.sort((a, b) => a.y - b.y).forEach((d) => this.drawDeco(ctx, d.x, d.y, d.s, rng));
    this.bg = c;
  }

  private drawDeco(ctx: Ctx, x: number, y: number, s: number, rng: () => number): void {
    const th = this.theme;
    ctx.save();
    ctx.translate(x, y);
    switch (th.deco) {
      case 'flowers': {
        ctx.fillStyle = '#4c9a49';
        ctx.beginPath(); ctx.ellipse(0, 0, s * 0.5, s * 0.22, 0, 0, Math.PI * 2); ctx.fill();
        const colors = ['#ff8fab', '#ffd166', '#ffffff', '#cdb4db'];
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
          ctx.beginPath(); ctx.arc((rng() - 0.5) * s * 0.7, -s * 0.1 - rng() * s * 0.1, s * 0.08, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'pines': case 'snowpines': {
        ctx.fillStyle = '#6b4a2b';
        ctx.fillRect(-s * 0.06, -s * 0.2, s * 0.12, s * 0.2);
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = th.deco === 'pines' ? ['#2d6a4f', '#40916c', '#52b788'][i] : ['#4f7c6b', '#6c9a87', '#ffffff'][i];
          ctx.beginPath(); ctx.moveTo(0, -s * (1.2 - i * 0.25)); ctx.lineTo(s * (0.45 - i * 0.08), -s * (0.15 + i * 0.25)); ctx.lineTo(-s * (0.45 - i * 0.08), -s * (0.15 + i * 0.25)); ctx.closePath(); ctx.fill();
        }
        break;
      }
      case 'cactus': {
        ctx.fillStyle = '#2a9d8f';
        roundRect(ctx, -s * 0.1, -s * 0.9, s * 0.2, s * 0.9, s * 0.1); ctx.fill();
        roundRect(ctx, -s * 0.36, -s * 0.6, s * 0.14, s * 0.32, s * 0.07); ctx.fill();
        roundRect(ctx, -s * 0.36, -s * 0.36, s * 0.3, s * 0.12, s * 0.06); ctx.fill();
        roundRect(ctx, s * 0.22, -s * 0.72, s * 0.14, s * 0.3, s * 0.07); ctx.fill();
        roundRect(ctx, s * 0.06, -s * 0.5, s * 0.3, s * 0.12, s * 0.06); ctx.fill();
        break;
      }
      case 'rocks': {
        ctx.fillStyle = '#4a2f2a';
        ctx.beginPath(); ctx.moveTo(-s * 0.5, 0); ctx.lineTo(-s * 0.3, -s * 0.4); ctx.lineTo(s * 0.1, -s * 0.5); ctx.lineTo(s * 0.45, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,123,0,0.6)';
        ctx.fillRect(-s * 0.1, -s * 0.25, s * 0.25, s * 0.04);
        break;
      }
      case 'clouds': {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        for (const [dx, r] of [[-0.3, 0.25], [0, 0.35], [0.3, 0.25]]) { ctx.beginPath(); ctx.arc(dx * s, -r * s, r * s, 0, Math.PI * 2); ctx.fill(); }
        break;
      }
    }
    ctx.restore();
  }

  private updateAmbient(dt: number): void {
    const th = this.theme;
    const target = this.opts.reducedMotion ? 8 : 28;
    while (this.ambient.length < target) {
      const snow = th.ambient === 'snow', leaves = th.ambient === 'leaves';
      this.ambient.push({
        x: Math.random() * this.w, y: snow || leaves ? -10 - Math.random() * this.h : this.field.y + Math.random() * this.field.h,
        vx: (Math.random() - 0.5) * 12 + (leaves ? 14 : 0), vy: snow ? 18 + Math.random() * 18 : leaves ? 22 + Math.random() * 10 : th.ambient === 'embers' ? -14 - Math.random() * 12 : (Math.random() - 0.5) * 6,
        life: 0, max: 6 + Math.random() * 6, size: snow ? 2 + Math.random() * 2.5 : 1.5 + Math.random() * 2, color: '', kind: 'spark', rot: Math.random() * 6,
      });
    }
    for (const p of this.ambient) {
      p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot = (p.rot ?? 0) + dt;
    }
    this.ambient = this.ambient.filter((p) => p.life < p.max && p.y < this.h + 20 && p.y > -this.h);
  }

  private drawAmbient(ctx: Ctx): void {
    const kind = this.theme.ambient;
    for (const p of this.ambient) {
      const fade = Math.sin((p.life / p.max) * Math.PI);
      ctx.globalAlpha = Math.max(0, fade) * 0.85;
      switch (kind) {
        case 'fireflies': case 'sparkles':
          ctx.fillStyle = kind === 'fireflies' ? '#fff3a3' : '#ffffff';
          ctx.beginPath(); ctx.arc(p.x + Math.sin((p.rot ?? 0) * 2) * 6, p.y, p.size * (0.7 + 0.3 * Math.sin(this.t * 6 + p.x)), 0, Math.PI * 2); ctx.fill();
          break;
        case 'snow':
          ctx.fillStyle = '#ffffff';
          ctx.beginPath(); ctx.arc(p.x + Math.sin((p.rot ?? 0) * 1.5) * 8, p.y, p.size, 0, Math.PI * 2); ctx.fill();
          break;
        case 'leaves':
          ctx.fillStyle = '#e9c46a';
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate((p.rot ?? 0) * 2);
          ctx.beginPath(); ctx.ellipse(0, 0, p.size * 2, p.size, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
          break;
        case 'embers':
          ctx.fillStyle = '#ffb703';
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 0.8, 0, Math.PI * 2); ctx.fill();
          break;
        case 'dust':
          ctx.fillStyle = 'rgba(255,240,210,0.8)';
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
          break;
      }
    }
    ctx.globalAlpha = 1;
  }

  render(state: LevelState | null, dt: number, ui: { targetId: number | null; listening: boolean; hpRatio?: number; intro?: number; introTotal?: number }): void {
    const ctx = this.ctx;
    this.t += dt;
    if (!this.bg) this.buildBackground();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    let sx = 0, sy = 0;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      sx = (Math.random() - 0.5) * this.shake * 18;
      sy = (Math.random() - 0.5) * this.shake * 18;
    }
    ctx.save();
    ctx.translate(sx, sy);
    if (this.bg) ctx.drawImage(this.bg, 0, 0, this.w, this.h);
    this.updateAmbient(dt);
    this.drawAmbient(ctx);

    const L = this.layout;
    const hp = state ? state.castleHp / state.castleMax : ui.hpRatio ?? 1;

    // Things drawn in depth order (by y).
    type Drawable = { y: number; draw: () => void };
    const list: Drawable[] = [];

    list.push({
      y: L.castle.y,
      draw: () => {
        const r = drawCastle(ctx, L.castle.x, L.castle.y, L.castle.scale, {
          walls: this.opts.walls, banner: this.opts.banner, hp, t: this.t, charging: ui.listening, magic: this.opts.magic, mirror: this.rtl,
        });
        this.orb = r.orb;
        if (this.castleFlash > 0) {
          ctx.save();
          ctx.globalAlpha = this.castleFlash * 0.35;
          ctx.fillStyle = '#ff9e9e';
          ctx.beginPath(); ctx.arc(L.castle.x, L.castle.y - 30 * L.castle.scale, 40 * L.castle.scale, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
          this.castleFlash = Math.max(0, this.castleFlash - dt * 2);
        }
      },
    });

    if (state) {
      for (const e of state.enemies) {
        if (e.status !== 'walking' || this.hidden.has(e.id)) continue;
        const pos = this.enemyPos(e);
        const conf = this.confused.get(e.id) ?? 0;
        if (conf > 0) this.confused.set(e.id, Math.max(0, conf - dt * 1.2));
        const hurt = this.hurt.get(e.id) ?? 0;
        if (hurt > 0) this.hurt.set(e.id, Math.max(0, hurt - dt * 2.2));
        list.push({
          y: pos.y,
          draw: () => drawEnemy(ctx, e.type, pos.x, pos.y, L.unit, {
            t: this.t + e.id * 1.7, facing: pos.facing, confused: conf, target: e.id === ui.targetId, frozen: e.frozen,
            phase: e.phase, phases: e.items.length, hurt,
          }),
        });
      }
    }
    for (const d of this.dying) {
      d.t += dt;
      const k = Math.min(1, d.t / 0.45);
      list.push({
        y: d.y,
        draw: () => {
          ctx.save();
          ctx.globalAlpha = 1 - k;
          ctx.translate(d.x, d.y);
          ctx.scale(1 + k * 0.4, 1 - k * 0.8);
          drawEnemy(ctx, d.type, 0, 0, L.unit, { t: this.t, facing: d.facing, confused: 0, target: false, frozen: false });
          ctx.restore();
        },
      });
    }
    this.dying = this.dying.filter((d) => d.t < 0.45);
    list.sort((a, b) => a.y - b.y).forEach((d) => d.draw());

    // Labels above everything else in the scene, target last (on top).
    if (state) {
      const walking = state.enemies.filter((e) => e.status === 'walking' && !this.hidden.has(e.id));
      walking.sort((a) => (a.id === ui.targetId ? 1 : -1));
      for (const e of walking) this.drawLabel(ctx, e, e.id === ui.targetId, ui.listening);
    }

    this.updateProjectiles(ctx, dt, state);
    this.updateParticles(ctx, dt);
    this.updateFloaters(ctx, dt);
    ctx.restore();
    if (state && (ui.intro ?? 0) > 0) this.drawBossIntro(ctx, state, ui.intro!, ui.introTotal ?? 2.4);
  }

  /**
   * "Here comes the boss": the scene dims, red bars sweep in and the troll
   * rises up from the road's far end while the banner plays. Nothing moves in
   * the simulation meanwhile (see levelState.bossStep).
   */
  private drawBossIntro(ctx: Ctx, state: LevelState, left: number, total: number): void {
    const k = 1 - Math.max(0, left) / total;                       // 0 → 1
    const fade = Math.min(1, k * 5, (1 - k) * 4 + 0.2);            // quick in, gentle out
    const w = this.w, h = this.h, u = this.layout.unit;
    ctx.save();
    ctx.globalAlpha = 0.55 * fade;
    ctx.fillStyle = '#12002b';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = fade;
    const bar = h * 0.1 * Math.min(1, k * 4);
    ctx.fillStyle = '#c1121f';
    ctx.fillRect(0, h * 0.28 - bar / 2, w, bar);
    ctx.fillRect(0, h * 0.5 - bar / 2 + h * 0.2, w, bar * 0.5);
    // The boss rises and grows.
    const boss = state.enemies.find((e) => e.type === 'boss');
    if (boss) {
      const rise = 1 - Math.pow(1 - Math.min(1, k * 1.6), 3);
      drawEnemy(ctx, 'boss', w / 2, h * (0.62 + 0.2 * (1 - rise)), u * (0.6 + 0.6 * rise), {
        t: this.t, facing: this.rtl ? -1 : 1, confused: 0, target: false, frozen: false,
        phase: 0, phases: boss.items.length,
      });
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const size = u * 1.3 * (0.8 + 0.2 * Math.min(1, k * 3));
    ctx.font = `900 ${size}px "Fredoka", "Noto Sans Hebrew", system-ui, sans-serif`;
    ctx.lineWidth = u * 0.12;
    ctx.strokeStyle = '#3a0010';
    ctx.strokeText(this.opts.bossLabel, w / 2, h * 0.28);
    ctx.fillStyle = '#fff4d6';
    ctx.fillText(this.opts.bossLabel, w / 2, h * 0.28);
    ctx.restore();
  }

  private drawLabel(ctx: Ctx, e: Enemy, isTarget: boolean, listening: boolean): void {
    const L = this.layout;
    const pos = this.enemyPos(e);
    const item = currentItem(e);
    const u = L.unit;
    const he = this.opts.lang === 'he';
    const text = item.display;
    // Long sentences are read from the big reading panel; the plaque shows
    // a drawn scroll so the board stays uncluttered.
    const long = text.length > 16;
    const base = (isTarget ? 0.62 : 0.44) * u * (this.opts.bigText ? 1.2 : 1) * (he ? 1.15 : 1);
    const font = he
      ? `700 ${base}px "Noto Sans Hebrew", "Arial Hebrew", "David", Arial, sans-serif`
      : `700 ${base}px "Andika", "Fredoka", "Nunito", system-ui, sans-serif`;
    ctx.font = font;
    ctx.direction = he ? 'rtl' : 'ltr';
    const tw = long ? base * 1.2 : ctx.measureText(text).width;
    const padX = base * 0.45, padY = base * 0.32;
    const bw = tw + padX * 2, bh = base * (he ? 1.45 : 1.25) + padY;
    const bob = isTarget && !this.opts.reducedMotion ? Math.sin(this.t * 4) * u * 0.05 : 0;
    let cx = pos.x;
    const top = pos.y - enemyTop(e.type, u) - bh - u * 0.18 + bob;
    cx = Math.max(bw / 2 + 4, Math.min(this.w - bw / 2 - 4, cx));
    const ty = Math.max(this.field.y + 4, top);

    ctx.save();
    if (isTarget) {
      ctx.shadowColor = listening ? '#7ae7ff' : '#ffd166';
      ctx.shadowBlur = u * 0.5;
    }
    ctx.fillStyle = isTarget ? '#fffdf5' : 'rgba(255,255,255,0.86)';
    roundRect(ctx, cx - bw / 2, ty, bw, bh, base * 0.35);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = isTarget ? Math.max(3, u * 0.07) : 1.5;
    ctx.strokeStyle = isTarget ? (listening ? '#22b8cf' : '#f4a300') : 'rgba(60,60,90,0.35)';
    ctx.stroke();
    // Pointer.
    ctx.fillStyle = isTarget ? '#fffdf5' : 'rgba(255,255,255,0.86)';
    ctx.beginPath(); ctx.moveTo(cx - base * 0.25, ty + bh - 1); ctx.lineTo(cx, ty + bh + base * 0.3); ctx.lineTo(cx + base * 0.25, ty + bh - 1); ctx.closePath(); ctx.fill();
    if (long) {
      const sw = base * 1.1, sh = base * 0.8, sx0 = cx - sw / 2, sy0 = ty + bh / 2 - sh / 2;
      ctx.fillStyle = '#f6e7c1';
      ctx.strokeStyle = '#a07a3c';
      ctx.lineWidth = Math.max(1.5, base * 0.06);
      roundRect(ctx, sx0, sy0, sw, sh, base * 0.08); ctx.fill(); ctx.stroke();
      for (const ex of [sx0, sx0 + sw]) { ctx.beginPath(); ctx.ellipse(ex, sy0 + sh / 2, base * 0.1, sh / 2 + base * 0.05, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      ctx.strokeStyle = '#7a5a2a';
      for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(sx0 + sw * 0.2, sy0 + (sh * i) / 4); ctx.lineTo(sx0 + sw * 0.8, sy0 + (sh * i) / 4); ctx.stroke(); }
    } else {
      ctx.fillStyle = '#1f1d36';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = font;
      ctx.fillText(text, cx, ty + bh / 2 + base * (he ? 0.08 : 0.04));
    }
    ctx.restore();

    if (isTarget) {
      // Bouncing arrow over the plaque: a shape cue, not only colour.
      const ay = ty - u * 0.32 + (this.opts.reducedMotion ? 0 : Math.sin(this.t * 6) * u * 0.06);
      ctx.save();
      ctx.fillStyle = listening ? '#22b8cf' : '#f4a300';
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - u * 0.18, ay - u * 0.18); ctx.lineTo(cx + u * 0.18, ay - u * 0.18); ctx.lineTo(cx, ay + u * 0.06); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  private updateProjectiles(ctx: Ctx, dt: number, state: LevelState | null): void {
    for (const p of this.projectiles) {
      p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      const e = state?.enemies.find((x) => x.id === p.enemyId);
      const target = e ? this.enemyPos(e) : { x: p.fx, y: p.fy };
      const tx = target.x, ty = target.y - this.layout.unit * 0.5;
      const x = p.fx + (tx - p.fx) * k;
      const y = p.fy + (ty - p.fy) * k - Math.sin(k * Math.PI) * this.layout.unit * 1.2;
      const g = ctx.createRadialGradient(x, y, 0, x, y, this.layout.unit * 0.35);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.4, p.color); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, this.layout.unit * 0.35, 0, Math.PI * 2); ctx.fill();
      if (!this.opts.reducedMotion) this.particles.push({ x, y, vx: 0, vy: 0, life: 0, max: 0.25, size: this.layout.unit * 0.08, color: p.color, kind: 'spark' });
      if (k >= 1) p.onHit();
    }
    this.projectiles = this.projectiles.filter((p) => p.t < p.dur);
  }

  private updateParticles(ctx: Ctx, dt: number): void {
    for (const p of this.particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'confetti' || p.kind === 'star') p.vy += this.layout.unit * 3 * dt;
      p.vx *= 0.96; p.vy *= p.kind === 'confetti' ? 0.99 : 0.96;
      const a = 1 - p.life / p.max;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = p.color;
      if (p.kind === 'star') {
        this.star(ctx, p.x, p.y, p.size, (p.rot ?? 0) + p.life * 4);
      } else if (p.kind === 'ring') {
        ctx.strokeStyle = p.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 + p.life * 30), 0, Math.PI * 2); ctx.stroke();
      } else if (p.kind === 'confetti') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate((p.rot ?? 0) + p.life * 6);
        ctx.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size); ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (p.kind === 'dust' ? 1.6 + p.life * 3 : 1), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter((p) => p.life < p.max);
  }

  private star(ctx: Ctx, x: number, y: number, r: number, rot: number): void {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? r * 0.45 : r;
      const a = rot + (i * Math.PI) / 5;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  private updateFloaters(ctx: Ctx, dt: number): void {
    for (const f of this.floaters) {
      f.t += dt;
      ctx.globalAlpha = Math.max(0, 1 - f.t / 1.1);
      ctx.font = `800 ${f.size}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(40,20,60,0.7)';
      ctx.strokeText(f.text, f.x, f.y - f.t * this.layout.unit);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - f.t * this.layout.unit);
    }
    ctx.globalAlpha = 1;
    this.floaters = this.floaters.filter((f) => f.t < 1.1);
  }

  /** Clear transient effects between levels. */
  reset(): void {
    this.particles = [];
    this.projectiles = [];
    this.dying = [];
    this.floaters = [];
    this.confused.clear();
    this.hurt.clear();
    this.hidden.clear();
    this.shake = 0;
  }
}
