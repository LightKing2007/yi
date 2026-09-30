/** 特效公共部分：终局计时、冲击波、粒子、震屏与闪白 */
import { game } from '../app/state';
import { settings } from '../app/settings';
import { GameType, easeOut } from '../core/types';
import { PAD, type Layout } from '../render/layout';
import type { Painter } from '../render/painter';

export interface Particle { x: number; y: number; vx: number; vy: number; t0: number; life: number; size: number; drag: number; grav: number; hue: number; kind: number }

export const WIN_STAGGER = 0.075;  // 连珠棋子从最后一子向两端依次点亮的间隔
export const WIN_HIT = 0.15;       // 最后一子落定（冲击）相对连珠时刻的延迟
export const WIN_RIPPLE = 1.4;     // 每颗棋子涟漪扩散一次的时长

export const rnd = (a: number, b: number) => a + (b - a) * Math.random();

const MAXPT = 1600;
let particles: Particle[] = [];

/** 胜利动画进行时间（以冲击时刻为 0）；无胜利动画时返回很小的负数 */
export function winClock(now: number) {
  const g = game;
  if (g.type !== GameType.Gomoku || g.winT <= 0 || (g.win.length < 5 && !g.forfeit)) return -1e9;
  return now - g.winT - WIN_HIT;
}

/** 围棋“胜负揭晓”动画进行时间（以确认结果为 0） */
export function goEndClock(now: number) {
  const g = game;
  if (g.type !== GameType.Go || !(g.finished || g.forfeit) || g.goEndT <= 0) return -1e9;
  return now - g.goEndT;
}

const endClock = (now: number) => Math.max(winClock(now), goEndClock(now));

/** 以 (cx, cy) 为中心、扫过整个棋盘的冲击波到达交叉点 (gx, gy) 的时刻（以格为单位，与窗口大小无关） */
export function waveArrival(gx: number, gy: number, cx: number, cy: number) {
  const d = Math.hypot(gx - cx, gy - cy);
  const bw = game.N - 1 + 2 * PAD;
  const e = Math.min(Math.max((d - 0.482 * 1.2) / (bw * 0.85), 0), 0.999);
  return (1 - Math.cbrt(1 - e)) * 1.1;
}

export function clearParticles() { particles = []; }
export function emit(p: Particle) { if (particles.length < MAXPT) particles.push(p); }

/** 棋盘整体的震动：位移、冲击时的缩放、轻微的旋转晃动（度） */
export function winShake(L: Layout, now: number) {
  const t = endClock(now), s = settings.value;
  const out = { x: 0, y: 0, scale: 1, rot: 0 };
  if (!s.shake || s.fx === 0 || t < -WIN_HIT || t > 1.4) return out;
  if (t < 0) {                                           // 冲击前的一瞬：整盘微微收紧
    const u = (t + WIN_HIT) / WIN_HIT;
    out.scale = 1 - 0.012 * u * u;
    return out;
  }
  const a = L.cell * 0.4 * Math.exp(-t * 3.6);           // 沉重的震动：频率低、幅度大、衰减慢
  out.scale = 1 + 0.028 * Math.exp(-t * 3.2) * Math.cos(t * 8);
  out.rot = 0.6 * Math.exp(-t * 3.2) * Math.sin(t * 17 + 0.6);
  out.x = a * (0.7 * Math.sin(t * 47) + 0.3 * Math.sin(t * 73 + 1.3));
  out.y = a * (0.7 * Math.cos(t * 41) + 0.3 * Math.sin(t * 67 + 0.4));
  return out;
}

/** 从 (cx, cy) 透出的几道宽而柔的光：像云层裂开时的天光，缓缓展开、慢慢淡去 */
export function drawLightBurst(p: Painter, L: Layout, cx: number, cy: number, t: number, reach: number) {
  if (t < 0 || t > 2.6 || settings.value.fx < 2) return;
  p.blend('add');
  for (let i = 0; i < 12; i++) {
    let h1 = Math.sin(i * 12.9898) * 43758.5453; h1 -= Math.floor(h1);
    let h2 = Math.sin(i * 78.233) * 12543.853; h2 -= Math.floor(h2);
    const ang = i * 0.5236 + (h1 - 0.5) * 0.35 + t * 0.04;
    const grow = easeOut(Math.min(t / 0.8, 1));
    const len = reach * (0.55 + 0.45 * h2) * (0.3 + 0.7 * grow);
    const th = L.cell * (0.9 + 0.8 * h1);
    const a = (0.1 + 0.1 * h2) * Math.min(1, t / 0.08) * Math.exp(-t * 1.3);
    p.fxBeam(cx + Math.cos(ang) * len * 0.5, cy + Math.sin(ang) * len * 0.5, len, th, (ang * 180) / Math.PI, 0.35 + 0.3 * h1, a);
  }
  p.fxGlow(cx, cy, L.cell * 7, 0.4, 0.35 * Math.exp(-t * 1.8) * Math.min(1, t / 0.05));
  p.blend('alpha');
}

/** 粒子积分并回收过期的 */
export function updateParticles(now: number, dt: number) {
  particles = particles.filter(q => {
    const age = now - q.t0;
    if (age > q.life) return false;
    if (age >= 0) {
      const k = Math.exp(-q.drag * dt);
      q.vx *= k; q.vy *= k;
      q.vy += q.grav * dt;
      q.x += q.vx * dt; q.y += q.vy * dt;
    }
    return true;
  });
}

/** 从 (cx, cy) 扩散到整个棋盘的金色冲击波，只在棋盘面内可见 */
export function drawShockwave(p: Painter, L: Layout, cx: number, cy: number, t: number) {
  if (t < 0 || t > 1.4) return;
  p.blend('add');
  p.g.scissor(L.board);
  for (let j = 0; j < 2; j++) {
    const u = (t - j * 0.16) / 1.1;
    if (u < 0 || u >= 1) continue;
    const r = L.R * 1.2 + easeOut(u) * L.board.w * (j ? 0.62 : 0.85);
    p.fxRing(cx, cy, r, Math.max(2, L.cell * (0.55 - 0.4 * u)), true, (j ? 0.35 : 0.6) * Math.pow(1 - u, 1.5));
  }
  if (t < 0.5) p.fxGlow(cx, cy, L.cell * 4, 0.35, 0.55 * Math.exp(-t * 8));
  p.g.scissor(null);
  p.blend('alpha');
}

/** 粒子：暖色的本体画在 body 上（浅色木面上也看得见），发光的内核叠加在 glow 上 */
export function drawParticles(body: Painter, glow: Painter, now: number) {
  if (!particles.length) return;
  for (let pass = 0; pass < 2; pass++) {
    const p = pass ? glow : body;
    if (pass) p.blend('add');
    for (const q of particles) {
      const age = now - q.t0;
      if (age < 0) continue;
      const u = age / q.life, fade = (1 - u) * (1 - u);
      const hue = pass ? q.hue * 0.3 : q.hue, sz = pass ? 0.7 : 1;
      if (q.kind === 1) {
        const sp = Math.hypot(q.vx, q.vy);
        const len = q.size * (1.6 + sp / (q.size * 12));
        p.fxBeam(q.x, q.y, len * sz, q.size * 1.3 * sz, (Math.atan2(q.vy, q.vx) * 180) / Math.PI, hue, fade * 1.3);
      } else {
        const tw = q.kind === 2 ? 0.65 + 0.35 * Math.sin(age * 13 + q.hue * 40) : 1;
        const sway = q.kind === 2 ? Math.sin(age * 2.4 + q.hue * 17) * q.size * 1.5 : 0;
        const a = q.kind === 2 ? Math.min(1, age * 4) * (1 - u) * tw : fade * 0.8;
        p.fxGlow(q.x + sway, q.y, q.size * sz, hue, a);
      }
    }
    if (pass) p.blend('alpha');
  }
}

/** 画面四周压暗的电影感暗角（alpha 0..1） */
function vignette(p: Painter, w: number, h: number, a: number) {
  if (a < 0.004) return;
  const d = [16 / 255, 10 / 255, 4 / 255, a] as const, z = [16 / 255, 10 / 255, 4 / 255, 0] as const;
  const bw = w / 4, bh = h / 4;
  p.gradH(0, 0, bw, h, d, z);
  p.gradH(w - bw, 0, bw, h, z, d);
  p.gradV(0, 0, w, bh, d, z);
  p.gradV(0, h - bh, w, bh, z, d);
}

/** 冲击前一瞬的压暗（像屏住呼吸），冲击时一记暖色闪光（画在发光层上），之后暗角久久不散，托出盘上的光 */
export function drawFlash(p: Painter, glow: Painter, w: number, h: number, now: number) {
  const t = endClock(now);
  if (settings.value.fx < 2 || t < -WIN_HIT || t > 4) return;
  if (t < 0) {
    const u = (t + WIN_HIT) / WIN_HIT;
    p.rect(0, 0, w, h, [20 / 255, 12 / 255, 4 / 255, (70 / 255) * u * u]);
    vignette(p, w, h, (120 / 255) * u);
    return;
  }
  vignette(p, w, h, (120 / 255) * Math.exp(-Math.max(t - 1.2, 0) * 1.1));
  if (t < 0.9) {
    glow.blend('add');
    glow.rect(0, 0, w, h, [1, 214 / 255, 160 / 255, (85 / 255) * Math.exp(-t * 4.5)]);
    glow.blend('alpha');
  }
}
