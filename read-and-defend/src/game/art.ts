/**
 * Original procedural artwork: every castle, monster and landscape is drawn
 * from shapes in code — no third-party sprites, nothing to license.
 */
import type { EnemyType } from './levelState';
import type { EnvironmentId } from './levels';

type Ctx = CanvasRenderingContext2D;

export interface Theme {
  sky: [string, string, string];
  far: string;
  mid: string;
  ground: [string, string];
  road: string;
  roadEdge: string;
  accent: string;
  sun: string;
  ambient: 'fireflies' | 'leaves' | 'dust' | 'snow' | 'embers' | 'sparkles';
  deco: 'flowers' | 'pines' | 'cactus' | 'snowpines' | 'rocks' | 'clouds';
}

export const THEMES: Record<EnvironmentId, Theme> = {
  meadow: { sky: ['#7ec8f2', '#bfe7ff', '#fff4d6'], far: '#8fb8de', mid: '#79c08a', ground: ['#6cc46a', '#3f9a4c'], road: '#e6c48f', roadEdge: '#b8925c', accent: '#ffd166', sun: '#fff1a8', ambient: 'fireflies', deco: 'flowers' },
  forest: { sky: ['#5fa8d3', '#a7dbd8', '#e8f6e0'], far: '#5a8f7b', mid: '#3f7d58', ground: ['#4f9a4f', '#2d6b3a'], road: '#c9a777', roadEdge: '#8d6b45', accent: '#b5e48c', sun: '#fdf5c9', ambient: 'leaves', deco: 'pines' },
  canyon: { sky: ['#f4a261', '#f7c59f', '#ffe8cc'], far: '#c97c5d', mid: '#d99a6c', ground: ['#e0b07a', '#b9824f'], road: '#f2d9a8', roadEdge: '#b08050', accent: '#ffb703', sun: '#fff3b0', ambient: 'dust', deco: 'cactus' },
  snow: { sky: ['#9ec5f8', '#d6e6ff', '#f5f9ff'], far: '#b7c9e6', mid: '#dbe7f5', ground: ['#f2f7fc', '#cfdcee'], road: '#c6d3e3', roadEdge: '#93a7c2', accent: '#a0e7ff', sun: '#ffffff', ambient: 'snow', deco: 'snowpines' },
  volcano: { sky: ['#3d1e3f', '#8c3b4a', '#f08a4b'], far: '#5a2b3e', mid: '#6e3a3a', ground: ['#7a4a3a', '#4a2a24'], road: '#a8735a', roadEdge: '#5e3a2a', accent: '#ff7b00', sun: '#ffb38a', ambient: 'embers', deco: 'rocks' },
  sky: { sky: ['#6a4c93', '#a98bd6', '#ffd6f0'], far: '#c8b6ff', mid: '#e7c6ff', ground: ['#fef6ff', '#e0d1ff'], road: '#ffe9a8', roadEdge: '#d4b75f', accent: '#ffafcc', sun: '#fff7d6', ambient: 'sparkles', deco: 'clouds' },
};

/* ------------------------------------------------------------- helpers */

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

/* -------------------------------------------------------------- castle */

export interface CastleLook {
  walls: string;
  banner: string;
  hp: number; // 0..1
  t: number;
  charging: boolean;
  magic: string;
  mirror: boolean;
}

/** Castle with base centre at (x, y); about 52×80 units. */
export function drawCastle(ctx: Ctx, x: number, y: number, s: number, look: CastleLook): { orb: { x: number; y: number } } {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(look.mirror ? -s : s, s);
  const wall = look.walls;
  const dark = shade(wall, -45);
  const darker = shade(wall, -75);
  const light = shade(wall, 25);

  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath(); ctx.ellipse(0, 1, 34, 5, 0, 0, Math.PI * 2); ctx.fill();

  const block = (bx: number, by: number, bw: number, bh: number) => {
    const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    g.addColorStop(0, light); g.addColorStop(0.5, wall); g.addColorStop(1, dark);
    ctx.fillStyle = g;
    ctx.fillRect(bx, by, bw, bh);
    // Masonry lines.
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 0.6;
    for (let yy = by + 5; yy < by + bh; yy += 5) {
      ctx.beginPath(); ctx.moveTo(bx, yy); ctx.lineTo(bx + bw, yy); ctx.stroke();
      const off = ((yy / 5) % 2) * 3;
      for (let xx = bx + off; xx < bx + bw; xx += 6) { ctx.beginPath(); ctx.moveTo(xx, yy - 5); ctx.lineTo(xx, yy); ctx.stroke(); }
    }
  };
  const crenels = (bx: number, by: number, bw: number) => {
    ctx.fillStyle = wall;
    for (let cx = bx; cx < bx + bw - 1; cx += 4) ctx.fillRect(cx, by - 3, 2.6, 3);
  };

  // Curtain wall.
  block(-24, -26, 48, 26);
  crenels(-24, -26, 48);
  // Gate.
  ctx.fillStyle = darker;
  ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(-7, -11); ctx.arc(0, -11, 7, Math.PI, 0); ctx.lineTo(7, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#6b4a2b';
  ctx.beginPath(); ctx.moveTo(-5.5, 0); ctx.lineTo(-5.5, -11); ctx.arc(0, -11, 5.5, Math.PI, 0); ctx.lineTo(5.5, 0); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#3e2a18'; ctx.lineWidth = 0.7;
  for (let gx = -4; gx <= 4; gx += 2) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, -15); ctx.stroke(); }

  // Keep.
  block(-11, -54, 22, 28);
  crenels(-11, -54, 22);
  // Side towers.
  for (const tx of [-30, 20]) {
    block(tx, -44, 10, 44);
    ctx.fillStyle = look.banner;
    ctx.beginPath(); ctx.moveTo(tx - 2, -44); ctx.lineTo(tx + 5, -58); ctx.lineTo(tx + 12, -44); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.moveTo(tx + 5, -58); ctx.lineTo(tx + 12, -44); ctx.lineTo(tx + 5, -44); ctx.closePath(); ctx.fill();
    // Window glow.
    ctx.fillStyle = '#ffe08a';
    ctx.beginPath(); ctx.moveTo(tx + 3.5, -26); ctx.lineTo(tx + 3.5, -31); ctx.arc(tx + 5, -31, 1.5, Math.PI, 0); ctx.lineTo(tx + 6.5, -26); ctx.closePath(); ctx.fill();
  }
  // Keep windows.
  ctx.fillStyle = '#ffe08a';
  for (const wx of [-6, 3]) { ctx.beginPath(); ctx.moveTo(wx, -36); ctx.lineTo(wx, -42); ctx.arc(wx + 1.5, -42, 1.5, Math.PI, 0); ctx.lineTo(wx + 3, -36); ctx.closePath(); ctx.fill(); }

  // Waving banner on the keep.
  ctx.strokeStyle = '#5b4636'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, -57); ctx.lineTo(0, -76); ctx.stroke();
  ctx.fillStyle = look.banner;
  ctx.beginPath();
  ctx.moveTo(0, -76);
  for (let i = 0; i <= 10; i++) {
    const fx = i * 1.4;
    ctx.lineTo(fx, -76 + Math.sin(look.t * 4 + i * 0.6) * 0.9);
  }
  for (let i = 10; i >= 0; i--) {
    const fx = i * 1.4;
    ctx.lineTo(fx, -69 + Math.sin(look.t * 4 + i * 0.6) * 0.9);
  }
  ctx.closePath(); ctx.fill();

  // Magic orb on the keep — glows brighter while the child is reading.
  const pulse = look.charging ? 1 + Math.sin(look.t * 10) * 0.25 : 1;
  const orbColor = look.magic === 'rainbow' ? `hsl(${(look.t * 120) % 360},90%,65%)` : look.magic;
  const og = ctx.createRadialGradient(0, -60, 0, 0, -60, 9 * pulse);
  og.addColorStop(0, '#ffffff'); og.addColorStop(0.35, orbColor); og.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = og;
  ctx.beginPath(); ctx.arc(0, -60, (look.charging ? 9 : 6) * pulse, 0, Math.PI * 2); ctx.fill();

  // Damage: cracks, then missing stones and a scorch.
  if (look.hp < 0.75) {
    ctx.strokeStyle = 'rgba(40,30,30,0.7)'; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(-18, -24); ctx.lineTo(-15, -18); ctx.lineTo(-17, -12); ctx.lineTo(-14, -6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(14, -50); ctx.lineTo(11, -45); ctx.lineTo(13, -40); ctx.stroke();
  }
  if (look.hp < 0.45) {
    ctx.fillStyle = 'rgba(30,20,20,0.55)';
    ctx.beginPath(); ctx.moveTo(13, -26); ctx.lineTo(18, -26); ctx.lineTo(16, -21); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-20, -8, 4, 3, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(40,30,30,0.7)';
    ctx.beginPath(); ctx.moveTo(5, -22); ctx.lineTo(8, -16); ctx.lineTo(6, -10); ctx.stroke();
  }
  ctx.restore();
  return { orb: { x, y: y - 60 * s } };
}

/* ------------------------------------------------------------- enemies */

export interface EnemyLook {
  t: number;
  facing: 1 | -1;
  /** 0..1 "huh?" wobble after a wrong reading. */
  confused: number;
  target: boolean;
  frozen: boolean;
  phase?: number;
  phases?: number;
}

function eyes(ctx: Ctx, x: number, y: number, r: number, gap: number, t: number): void {
  const blink = Math.sin(t * 1.3) > 0.97 ? 0.2 : 1;
  for (const dx of [-gap, gap]) {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(x + dx, y, r, r * blink, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1d1d2b';
    ctx.beginPath(); ctx.ellipse(x + dx + r * 0.25, y + r * 0.1, r * 0.5, r * 0.5 * blink, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x + dx + r * 0.4, y - r * 0.2, r * 0.18, 0, Math.PI * 2); ctx.fill();
  }
}

/** Enemy standing on (x, y); u is the size unit (≈ body height). */
export function drawEnemy(ctx: Ctx, type: EnemyType, x: number, y: number, u: number, look: EnemyLook): void {
  ctx.save();
  ctx.translate(x, y);
  const wob = look.confused > 0 ? Math.sin(look.t * 30) * look.confused * 0.12 : 0;
  ctx.rotate(wob);
  ctx.scale(look.facing, 1);

  // Ground shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath(); ctx.ellipse(0, 0, u * (type === 'boss' ? 0.9 : 0.42), u * 0.1, 0, 0, Math.PI * 2); ctx.fill();

  if (look.frozen) {
    ctx.shadowColor = '#bde0fe';
    ctx.shadowBlur = u * 0.4;
  }
  const t = look.t;
  switch (type) {
    case 'slime': {
      const sq = 1 + Math.sin(t * 6) * 0.08;
      const g = ctx.createRadialGradient(-u * 0.12, -u * 0.45, u * 0.05, 0, -u * 0.3, u * 0.55);
      g.addColorStop(0, '#b9fbc0'); g.addColorStop(1, '#2bb673');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-u * 0.42 * sq, 0);
      ctx.bezierCurveTo(-u * 0.45 * sq, -u * 0.55 / sq, u * 0.45 * sq, -u * 0.55 / sq, u * 0.42 * sq, 0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.ellipse(-u * 0.15, -u * 0.32 / sq, u * 0.07, u * 0.04, -0.5, 0, Math.PI * 2); ctx.fill();
      eyes(ctx, u * 0.04, -u * 0.22 / sq, u * 0.07, u * 0.11, t);
      ctx.strokeStyle = '#1d6b46'; ctx.lineWidth = u * 0.025;
      ctx.beginPath(); ctx.arc(u * 0.05, -u * 0.12 / sq, u * 0.06, 0.2, Math.PI - 0.2); ctx.stroke();
      break;
    }
    case 'goblin': {
      const step = Math.sin(t * 7);
      ctx.fillStyle = '#4a7c3a';
      ctx.fillRect(-u * 0.14, -u * 0.18, u * 0.09, u * 0.18 + step * u * 0.03);
      ctx.fillRect(u * 0.05, -u * 0.18, u * 0.09, u * 0.18 - step * u * 0.03);
      ctx.fillStyle = '#8d5a3b';
      roundRect(ctx, -u * 0.22, -u * 0.5, u * 0.44, u * 0.36, u * 0.1); ctx.fill();
      ctx.fillStyle = '#7bc96f';
      ctx.beginPath(); ctx.arc(0, -u * 0.66, u * 0.22, 0, Math.PI * 2); ctx.fill();
      // Ears.
      ctx.beginPath(); ctx.moveTo(-u * 0.18, -u * 0.72); ctx.lineTo(-u * 0.42, -u * 0.86); ctx.lineTo(-u * 0.2, -u * 0.6); ctx.fill();
      ctx.beginPath(); ctx.moveTo(u * 0.18, -u * 0.72); ctx.lineTo(u * 0.42, -u * 0.86); ctx.lineTo(u * 0.2, -u * 0.6); ctx.fill();
      eyes(ctx, u * 0.04, -u * 0.7, u * 0.06, u * 0.08, t);
      ctx.strokeStyle = '#2d5a24'; ctx.lineWidth = u * 0.025;
      ctx.beginPath(); ctx.arc(u * 0.04, -u * 0.6, u * 0.05, 0.3, Math.PI - 0.3); ctx.stroke();
      // Little wooden club.
      ctx.save(); ctx.translate(u * 0.24, -u * 0.36); ctx.rotate(-0.5 + step * 0.15);
      ctx.fillStyle = '#a0703f'; roundRect(ctx, -u * 0.03, -u * 0.32, u * 0.07, u * 0.34, u * 0.03); ctx.fill();
      ctx.restore();
      break;
    }
    case 'bat': {
      const hover = Math.sin(t * 5) * u * 0.08;
      ctx.translate(0, -u * 0.9 + hover);
      const flap = Math.sin(t * 18);
      ctx.fillStyle = '#5e3c99';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * u * 0.12, 0);
        ctx.quadraticCurveTo(side * u * 0.5, -u * (0.35 + flap * 0.2), side * u * 0.62, u * 0.05 * flap);
        ctx.quadraticCurveTo(side * u * 0.42, u * 0.05, side * u * 0.3, u * 0.12);
        ctx.quadraticCurveTo(side * u * 0.2, u * 0.02, side * u * 0.12, u * 0.08);
        ctx.fill();
      }
      const g = ctx.createRadialGradient(0, -u * 0.04, 0, 0, 0, u * 0.24);
      g.addColorStop(0, '#9d7fe0'); g.addColorStop(1, '#4b2f86');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(0, 0, u * 0.2, u * 0.22, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-u * 0.14, -u * 0.14); ctx.lineTo(-u * 0.1, -u * 0.32); ctx.lineTo(-u * 0.03, -u * 0.18); ctx.fill();
      ctx.beginPath(); ctx.moveTo(u * 0.14, -u * 0.14); ctx.lineTo(u * 0.1, -u * 0.32); ctx.lineTo(u * 0.03, -u * 0.18); ctx.fill();
      eyes(ctx, u * 0.02, -u * 0.04, u * 0.055, u * 0.075, t);
      // Speed streaks.
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = u * 0.02;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-u * (0.7 + i * 0.12), -u * 0.1 + i * u * 0.08); ctx.lineTo(-u * (0.9 + i * 0.12), -u * 0.1 + i * u * 0.08); ctx.stroke(); }
      break;
    }
    case 'knight': {
      const step = Math.sin(t * 5);
      ctx.fillStyle = '#5d6d7e';
      ctx.fillRect(-u * 0.16, -u * 0.22, u * 0.12, u * 0.22 + step * u * 0.03);
      ctx.fillRect(u * 0.04, -u * 0.22, u * 0.12, u * 0.22 - step * u * 0.03);
      const g = ctx.createLinearGradient(-u * 0.3, 0, u * 0.3, 0);
      g.addColorStop(0, '#d6dde4'); g.addColorStop(0.5, '#9aa7b4'); g.addColorStop(1, '#5d6d7e');
      ctx.fillStyle = g;
      roundRect(ctx, -u * 0.28, -u * 0.62, u * 0.56, u * 0.44, u * 0.1); ctx.fill();
      // Helmet with visor slit and plume.
      ctx.fillStyle = g;
      roundRect(ctx, -u * 0.22, -u * 0.98, u * 0.44, u * 0.38, u * 0.18); ctx.fill();
      ctx.fillStyle = '#1d1d2b';
      roundRect(ctx, -u * 0.13, -u * 0.83, u * 0.3, u * 0.07, u * 0.03); ctx.fill();
      ctx.fillStyle = '#ffdd57';
      ctx.beginPath(); ctx.arc(u * 0.06, -u * 0.8, u * 0.025, 0, Math.PI * 2); ctx.arc(u * 0.0, -u * 0.8, u * 0.025, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e63946';
      ctx.beginPath(); ctx.moveTo(-u * 0.04, -u * 0.98);
      ctx.quadraticCurveTo(-u * 0.3, -u * 1.25 + Math.sin(t * 3) * u * 0.03, -u * 0.36, -u * 0.92);
      ctx.quadraticCurveTo(-u * 0.2, -u * 1.05, -u * 0.04, -u * 0.94); ctx.fill();
      // Shield.
      ctx.fillStyle = '#3a86ff';
      ctx.beginPath(); ctx.moveTo(u * 0.2, -u * 0.6); ctx.lineTo(u * 0.48, -u * 0.6); ctx.lineTo(u * 0.48, -u * 0.36); ctx.quadraticCurveTo(u * 0.34, -u * 0.16, u * 0.2, -u * 0.36); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffd166';
      ctx.beginPath(); ctx.arc(u * 0.34, -u * 0.46, u * 0.06, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'boss': {
      const B = u * 1.9;
      const step = Math.sin(t * 3.5);
      ctx.fillStyle = '#6d4c7d';
      ctx.fillRect(-B * 0.2, -B * 0.2, B * 0.14, B * 0.2 + step * B * 0.02);
      ctx.fillRect(B * 0.06, -B * 0.2, B * 0.14, B * 0.2 - step * B * 0.02);
      const g = ctx.createRadialGradient(-B * 0.1, -B * 0.55, B * 0.05, 0, -B * 0.45, B * 0.5);
      g.addColorStop(0, '#c39bd3'); g.addColorStop(1, '#7d3c98');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(0, -B * 0.45, B * 0.36, B * 0.32, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e8daef';
      ctx.beginPath(); ctx.ellipse(B * 0.04, -B * 0.38, B * 0.2, B * 0.18, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#a569bd';
      ctx.beginPath(); ctx.arc(0, -B * 0.82, B * 0.2, 0, Math.PI * 2); ctx.fill();
      // Horns.
      ctx.fillStyle = '#fdebd0';
      ctx.beginPath(); ctx.moveTo(-B * 0.14, -B * 0.95); ctx.quadraticCurveTo(-B * 0.3, -B * 1.12, -B * 0.22, -B * 1.2); ctx.quadraticCurveTo(-B * 0.2, -B * 1.05, -B * 0.06, -B * 0.98); ctx.fill();
      ctx.beginPath(); ctx.moveTo(B * 0.14, -B * 0.95); ctx.quadraticCurveTo(B * 0.3, -B * 1.12, B * 0.22, -B * 1.2); ctx.quadraticCurveTo(B * 0.2, -B * 1.05, B * 0.06, -B * 0.98); ctx.fill();
      eyes(ctx, B * 0.03, -B * 0.85, B * 0.045, B * 0.07, t);
      ctx.fillStyle = '#4a235a';
      ctx.beginPath(); ctx.ellipse(B * 0.04, -B * 0.73, B * 0.07, B * 0.03, 0, 0, Math.PI); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(-B * 0.0, -B * 0.73, B * 0.025, B * 0.03); ctx.fillRect(B * 0.07, -B * 0.73, B * 0.025, B * 0.03);
      // Big club.
      ctx.save(); ctx.translate(B * 0.34, -B * 0.5); ctx.rotate(-0.4 + step * 0.1);
      ctx.fillStyle = '#8b5a2b'; roundRect(ctx, -B * 0.05, -B * 0.5, B * 0.12, B * 0.55, B * 0.05); ctx.fill();
      ctx.restore();
      // Phase pips (how many readings are left), shape not just colour.
      if (look.phases && look.phases > 1) {
        for (let i = 0; i < look.phases; i++) {
          const done = i < (look.phase ?? 0);
          const px = (i - (look.phases - 1) / 2) * B * 0.16;
          ctx.fillStyle = done ? 'rgba(255,255,255,0.35)' : '#ffd166';
          ctx.strokeStyle = '#4a235a'; ctx.lineWidth = B * 0.015;
          ctx.beginPath(); ctx.arc(px, -B * 0.15, B * 0.05, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          if (done) { ctx.beginPath(); ctx.moveTo(px - B * 0.03, -B * 0.15); ctx.lineTo(px + B * 0.03, -B * 0.15); ctx.stroke(); }
        }
      }
      break;
    }
  }
  ctx.restore();

  if (look.confused > 0.05) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, look.confused * 1.5);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#3d3d5c';
    ctx.lineWidth = u * 0.03;
    const qy = y - u * (type === 'boss' ? 2.6 : 1.3) - (type === 'bat' ? u * 0.9 : 0);
    ctx.beginPath(); ctx.arc(x + u * 0.45, qy, u * 0.16, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3d3d5c';
    ctx.font = `bold ${u * 0.22}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('?', x + u * 0.45, qy + u * 0.01);
    ctx.restore();
  }
}

/** Height above the feet where the label plaque should sit. */
export function enemyTop(type: EnemyType, u: number): number {
  switch (type) {
    case 'slime': return u * 0.6;
    case 'goblin': return u * 0.95;
    case 'bat': return u * 1.25;
    case 'knight': return u * 1.25;
    case 'boss': return u * 2.35;
  }
}
