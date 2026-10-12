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
  /** 1 → 0 after being hit (a boss losing a word): flash and recoil. */
  hurt?: number;
  /** Which boss to draw (one per world). */
  variant?: BossVariant;
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

/** Which boss: one per world, each with its own look. */
export type BossVariant = 'troll' | 'meadow' | 'forest' | 'canyon' | 'snow' | 'volcano' | 'sky';

function blob(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient): void {
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
}

function grad(ctx: Ctx, B: number, y: number, r: number, light: string, dark: string): CanvasGradient {
  const g = ctx.createRadialGradient(-B * 0.1, y - r * 0.4, B * 0.04, 0, y, r);
  g.addColorStop(0, light); g.addColorStop(1, dark);
  return g;
}

function mouth(ctx: Ctx, x: number, y: number, w: number, color: string, teeth = true): void {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(x, y, w, w * 0.45, 0, 0, Math.PI); ctx.fill();
  if (teeth) { ctx.fillStyle = '#fff'; ctx.fillRect(x - w * 0.6, y, w * 0.35, w * 0.35); ctx.fillRect(x + w * 0.25, y, w * 0.35, w * 0.35); }
}

/**
 * The six world bosses (and the original troll). All stand on (0,0), are
 * about 1.2·B tall and face +x; the caller flips them for right-to-left.
 */
function drawBoss(ctx: Ctx, v: BossVariant, B: number, t: number, step: number): void {
  switch (v) {
    case 'meadow': {
      // King Slime: a huge wobbling jelly with a golden crown.
      const sq = 1 + Math.sin(t * 4) * 0.06;
      ctx.fillStyle = grad(ctx, B, -B * 0.45, B * 0.6, '#c7f9cc', '#2d9d5f');
      ctx.beginPath();
      ctx.moveTo(-B * 0.5 * sq, 0);
      ctx.bezierCurveTo(-B * 0.55 * sq, -B * 1.05 / sq, B * 0.55 * sq, -B * 1.05 / sq, B * 0.5 * sq, 0);
      ctx.closePath(); ctx.fill();
      blob(ctx, -B * 0.2, -B * 0.62 / sq, B * 0.08, B * 0.05, 'rgba(255,255,255,0.55)');
      eyes(ctx, B * 0.05, -B * 0.5 / sq, B * 0.07, B * 0.13, t);
      mouth(ctx, B * 0.05, -B * 0.3 / sq, B * 0.12, '#1b5e3a');
      // Crown.
      const cy = -B * 0.8 / sq;
      ctx.fillStyle = '#ffd166'; ctx.strokeStyle = '#b8860b'; ctx.lineWidth = B * 0.015;
      ctx.beginPath();
      ctx.moveTo(-B * 0.2, cy); ctx.lineTo(-B * 0.22, cy - B * 0.2); ctx.lineTo(-B * 0.1, cy - B * 0.1);
      ctx.lineTo(0, cy - B * 0.26); ctx.lineTo(B * 0.1, cy - B * 0.1); ctx.lineTo(B * 0.22, cy - B * 0.2); ctx.lineTo(B * 0.2, cy);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      for (const [dx, c] of [[-B * 0.1, '#ef476f'], [B * 0.1, '#118ab2']] as const) blob(ctx, dx, cy - B * 0.05, B * 0.025, B * 0.025, c);
      break;
    }
    case 'forest': {
      // Tree Troll: a walking trunk with a leafy head and branch arms.
      ctx.fillStyle = '#5d4037';
      ctx.fillRect(-B * 0.2, -B * 0.18, B * 0.13, B * 0.18 + step * B * 0.02);
      ctx.fillRect(B * 0.07, -B * 0.18, B * 0.13, B * 0.18 - step * B * 0.02);
      ctx.fillStyle = '#795548';
      roundRect(ctx, -B * 0.28, -B * 0.85, B * 0.56, B * 0.7, B * 0.12); ctx.fill();
      ctx.strokeStyle = '#4e342e'; ctx.lineWidth = B * 0.015;
      for (const x of [-B * 0.15, 0, B * 0.15]) { ctx.beginPath(); ctx.moveTo(x, -B * 0.8); ctx.quadraticCurveTo(x + B * 0.04, -B * 0.5, x, -B * 0.2); ctx.stroke(); }
      // Branch arms, swaying.
      ctx.lineWidth = B * 0.05; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(B * 0.26, -B * 0.6); ctx.lineTo(B * 0.5, -B * 0.75 + step * B * 0.05); ctx.lineTo(B * 0.6, -B * 0.9 + step * B * 0.05); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-B * 0.26, -B * 0.6); ctx.lineTo(-B * 0.5, -B * 0.5 - step * B * 0.05); ctx.stroke();
      // Leaves.
      for (const [x, y, r] of [[0, -B * 1.0, 0.3], [-B * 0.24, -B * 0.92, 0.2], [B * 0.24, -B * 0.92, 0.2], [0, -B * 1.18, 0.16]] as const) blob(ctx, x, y, B * r, B * r * 0.8, '#43a047');
      blob(ctx, -B * 0.08, -B * 1.05, B * 0.1, B * 0.06, 'rgba(200,255,200,0.35)');
      eyes(ctx, B * 0.03, -B * 0.66, B * 0.055, B * 0.1, t);
      mouth(ctx, B * 0.03, -B * 0.45, B * 0.1, '#3e2723');
      break;
    }
    case 'canyon': {
      // Rock Golem: stacked boulders with glowing eyes.
      const glow = 0.6 + 0.4 * Math.sin(t * 5);
      for (const [x, y, rx, ry] of [[-B * 0.2, -B * 0.1, 0.14, 0.12], [B * 0.2, -B * 0.1, 0.14, 0.12]] as const) blob(ctx, x, y + (x < 0 ? step : -step) * B * 0.02, B * rx, B * ry, '#7f8c8d');
      blob(ctx, 0, -B * 0.5, B * 0.42, B * 0.34, grad(ctx, B, -B * 0.5, B * 0.45, '#bdc3c7', '#636e72'));
      blob(ctx, -B * 0.45, -B * 0.55 + step * B * 0.03, B * 0.14, B * 0.16, '#95a5a6');
      blob(ctx, B * 0.45, -B * 0.55 - step * B * 0.03, B * 0.14, B * 0.16, '#95a5a6');
      blob(ctx, 0, -B * 0.95, B * 0.24, B * 0.2, grad(ctx, B, -B * 0.95, B * 0.26, '#d0d3d4', '#7f8c8d'));
      ctx.strokeStyle = '#4d5656'; ctx.lineWidth = B * 0.015;
      ctx.beginPath(); ctx.moveTo(-B * 0.1, -B * 0.7); ctx.lineTo(-B * 0.02, -B * 0.55); ctx.lineTo(-B * 0.12, -B * 0.4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(B * 0.18, -B * 0.6); ctx.lineTo(B * 0.25, -B * 0.45); ctx.stroke();
      ctx.shadowColor = '#ff9f1c'; ctx.shadowBlur = B * 0.1 * glow;
      for (const dx of [-B * 0.08, B * 0.1]) blob(ctx, dx, -B * 0.98, B * 0.045, B * 0.03, `rgba(255,159,28,${0.7 + 0.3 * glow})`);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#2d3436'; ctx.fillRect(-B * 0.08, -B * 0.86, B * 0.18, B * 0.035);
      break;
    }
    case 'snow': {
      // Ice Yeti: white fur, a blue face and icicle horns.
      ctx.fillStyle = '#dfe6e9';
      ctx.fillRect(-B * 0.22, -B * 0.2, B * 0.15, B * 0.2 + step * B * 0.02);
      ctx.fillRect(B * 0.07, -B * 0.2, B * 0.15, B * 0.2 - step * B * 0.02);
      blob(ctx, 0, -B * 0.55, B * 0.4, B * 0.42, grad(ctx, B, -B * 0.55, B * 0.5, '#ffffff', '#b2bec3'));
      // Furry fringe.
      ctx.fillStyle = '#ffffff';
      for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.arc(i * B * 0.11, -B * 0.16, B * 0.06, 0, Math.PI * 2); ctx.fill(); }
      blob(ctx, -B * 0.42, -B * 0.55 + step * B * 0.04, B * 0.1, B * 0.2, '#f5f6fa');
      blob(ctx, B * 0.42, -B * 0.55 - step * B * 0.04, B * 0.1, B * 0.2, '#f5f6fa');
      blob(ctx, B * 0.03, -B * 0.82, B * 0.2, B * 0.17, '#74b9ff');
      eyes(ctx, B * 0.03, -B * 0.86, B * 0.045, B * 0.08, t);
      mouth(ctx, B * 0.03, -B * 0.74, B * 0.08, '#0c3c78');
      ctx.fillStyle = '#a5d8ff'; ctx.strokeStyle = '#4dabf7'; ctx.lineWidth = B * 0.01;
      for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sx * B * 0.12, -B * 0.97); ctx.lineTo(sx * B * 0.22, -B * 1.22); ctx.lineTo(sx * B * 0.04, -B * 1.0); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      break;
    }
    case 'volcano': {
      // Lava Dragon: red scales, flapping wings, a flickering flame.
      const flap = Math.sin(t * 6);
      ctx.fillStyle = '#922b21';
      for (const sx of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(sx * B * 0.15, -B * 0.7);
        ctx.lineTo(sx * B * 0.65, -B * (1.05 + flap * 0.12)); ctx.lineTo(sx * B * 0.55, -B * 0.75); ctx.lineTo(sx * B * 0.62, -B * 0.55);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(-B * 0.2, -B * 0.2, B * 0.13, B * 0.2 + step * B * 0.02);
      ctx.fillRect(B * 0.07, -B * 0.2, B * 0.13, B * 0.2 - step * B * 0.02);
      blob(ctx, 0, -B * 0.5, B * 0.34, B * 0.36, grad(ctx, B, -B * 0.5, B * 0.42, '#f1948a', '#b03a2e'));
      blob(ctx, B * 0.04, -B * 0.42, B * 0.18, B * 0.24, '#f9e79f');
      blob(ctx, B * 0.06, -B * 0.92, B * 0.22, B * 0.18, '#cb4335');
      blob(ctx, B * 0.26, -B * 0.86, B * 0.13, B * 0.09, '#cb4335');
      ctx.fillStyle = '#fdebd0';
      for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sx * B * 0.1 + B * 0.04, -B * 1.05); ctx.lineTo(sx * B * 0.16 + B * 0.04, -B * 1.2); ctx.lineTo(sx * B * 0.02 + B * 0.04, -B * 1.08); ctx.fill(); }
      eyes(ctx, B * 0.06, -B * 0.97, B * 0.04, B * 0.07, t);
      // Flame breath, flickering.
      const f = 0.7 + 0.3 * Math.sin(t * 18);
      ctx.fillStyle = `rgba(255,140,0,${0.75 * f})`;
      ctx.beginPath(); ctx.moveTo(B * 0.38, -B * 0.86); ctx.quadraticCurveTo(B * 0.55, -B * (0.95 + 0.05 * f), B * (0.6 + 0.08 * f), -B * 0.84); ctx.quadraticCurveTo(B * 0.55, -B * 0.78, B * 0.38, -B * 0.84); ctx.fill();
      blob(ctx, B * 0.5, -B * 0.85, B * 0.05 * f, B * 0.03, 'rgba(255,230,120,0.9)');
      break;
    }
    case 'sky': {
      // Storm Wizard: floats on a cloud, star hat, crackling staff.
      const bob = Math.sin(t * 2.5) * B * 0.04;
      ctx.save(); ctx.translate(0, bob);
      for (const [x, r] of [[-B * 0.25, 0.16], [0, 0.2], [B * 0.25, 0.16]] as const) blob(ctx, x, -B * 0.1, B * r, B * r * 0.6, '#eceff1');
      ctx.fillStyle = grad(ctx, B, -B * 0.5, B * 0.5, '#b39ddb', '#5e35b1');
      ctx.beginPath(); ctx.moveTo(-B * 0.32, -B * 0.15); ctx.lineTo(0, -B * 0.85); ctx.lineTo(B * 0.32, -B * 0.15); ctx.closePath(); ctx.fill();
      blob(ctx, B * 0.02, -B * 0.82, B * 0.16, B * 0.15, '#ffe0b2');
      ctx.fillStyle = '#eeeeee';
      ctx.beginPath(); ctx.moveTo(-B * 0.1, -B * 0.76); ctx.quadraticCurveTo(B * 0.02, -B * 0.45, B * 0.14, -B * 0.76); ctx.fill();
      eyes(ctx, B * 0.02, -B * 0.85, B * 0.035, B * 0.06, t);
      ctx.fillStyle = '#4527a0';
      ctx.beginPath(); ctx.moveTo(-B * 0.2, -B * 0.93); ctx.lineTo(B * 0.06, -B * 1.3); ctx.lineTo(B * 0.22, -B * 0.93); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffd166';
      for (const [x, y] of [[0, -B * 1.05], [B * 0.1, -B * 1.15]] as const) { ctx.beginPath(); ctx.arc(x, y, B * 0.025, 0, Math.PI * 2); ctx.fill(); }
      ctx.strokeStyle = '#8d6e63'; ctx.lineWidth = B * 0.035; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(B * 0.4, -B * 0.1); ctx.lineTo(B * 0.4, -B * 1.0); ctx.stroke();
      const z = Math.sin(t * 9) > 0 ? 1 : 0.4;
      ctx.strokeStyle = `rgba(255,235,59,${z})`; ctx.lineWidth = B * 0.02;
      ctx.beginPath(); ctx.moveTo(B * 0.4, -B * 1.02); ctx.lineTo(B * 0.48, -B * 1.12); ctx.lineTo(B * 0.42, -B * 1.14); ctx.lineTo(B * 0.52, -B * 1.26); ctx.stroke();
      ctx.restore();
      break;
    }
    default: {
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
      break;
    }
  }
}

/** Enemy standing on (x, y); u is the size unit (≈ body height). */
export function drawEnemy(ctx: Ctx, type: EnemyType, x: number, y: number, u: number, look: EnemyLook): void {
  ctx.save();
  ctx.translate(x, y);
  const hurt = look.hurt ?? 0;
  const wob = look.confused > 0 ? Math.sin(look.t * 30) * look.confused * 0.12 : 0;
  ctx.rotate(wob + (hurt > 0 ? Math.sin(look.t * 40) * hurt * 0.1 : 0));
  // A hit squashes the monster briefly and makes it glow white.
  ctx.scale(look.facing * (1 + hurt * 0.12), 1 - hurt * 0.1);
  if (hurt > 0) { ctx.shadowColor = '#ffffff'; ctx.shadowBlur = u * 0.9 * hurt; }

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
      drawBoss(ctx, look.variant ?? 'troll', B, t, step);
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
