/** 五子棋连珠：光晕、点亮、涟漪、火花与余烬 */
import { game, boardView } from '../app/state';
import { settings } from '../app/settings';
import { sfx } from '../audio';
import { easeOut } from '../core/types';
import { pt, type Layout } from '../render/layout';
import type { Painter } from '../render/painter';
import { ensureBlowSim, emitBlowDust } from './blow';
import { WIN_HIT, WIN_RIPPLE, WIN_STAGGER, drawLightBurst, drawShockwave, emit, rnd, winClock } from './fx';

/** 连珠第 i 颗子的点亮时刻：从最后落下的一子向两端扩散 */
export function winDelay(i: number) {
  const g = game;
  let last = 0;
  g.win.forEach((w, k) => { if (w.x === g.cur.lastX && w.y === g.cur.lastY) last = k; });
  return Math.abs(i - last) * WIN_STAGGER;
}

export function winIndex(x: number, y: number) { return game.win.findIndex(w => w.x === x && w.y === y); }

function winCenter(L: Layout) {
  const w = game.win, a = pt(L, w[0].x, w[0].y), b = pt(L, w[w.length - 1].x, w[w.length - 1].y);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function winUpdate(L: Layout, now: number, dt: number) {
  const g = game, t = winClock(now), fx = settings.value.fx;
  ensureBlowSim();
  if (t >= -WIN_HIT && !boardView.winBurst) {                    // 音效从连珠时刻就开始（先是吸气声），冲击声正对 t = 0
    boardView.winBurst = 1;
    if (fx >= 1) { sfx.play('win'); sfx.duck(); }
  }
  if (fx === 2 && t >= 0 && boardView.winBurst === 1) {          // 粒子只在“完整”特效下出现
    boardView.winBurst = 2;
    emitBlowDust(L, now);
    const cell = L.cell;
    g.win.forEach((w, i) => {
      const c = pt(L, w.x, w.y), d = winDelay(i);
      for (let k = 0; k < 10; k++) {                     // 四溅的火花
        const ang = rnd(0, 6.2832), sp = cell * rnd(3.5, 12);
        emit({ x: c.x + Math.cos(ang) * L.R * 0.6, y: c.y + Math.sin(ang) * L.R * 0.6, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - cell * 1.5,
          t0: now + d, life: rnd(0.45, 1.05), size: cell * rnd(0.1, 0.17), drag: 3, grav: cell * 7, hue: rnd(0.3, 1), kind: 1 });
      }
      for (let k = 0; k < 7; k++) {                      // 较慢的光尘
        const ang = rnd(0, 6.2832), sp = cell * rnd(1, 3.5);
        emit({ x: c.x, y: c.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, t0: now + d, life: rnd(0.8, 1.6), size: cell * rnd(0.16, 0.3),
          drag: 2.2, grav: -cell * 0.4, hue: rnd(0, 0.6), kind: 0 });
      }
    });
  }
  if (fx === 2 && t > 0.1 && t < 3.2) {                  // 连珠上方持续升起的余烬
    const rate = 34 * (1 - t / 3.2) + 6, n = Math.floor(rate * dt + Math.random());
    const w = g.win, a = pt(L, w[0].x, w[0].y), b = pt(L, w[w.length - 1].x, w[w.length - 1].y);
    for (let k = 0; k < n; k++) {
      const u = Math.random();
      emit({ x: a.x + (b.x - a.x) * u + rnd(-1, 1) * L.R, y: a.y + (b.y - a.y) * u + rnd(-1, 1) * L.R,
        vx: rnd(-0.3, 0.3) * L.cell, vy: -L.cell * rnd(0.5, 1.3), t0: now, life: rnd(1.4, 2.6),
        size: L.cell * rnd(0.09, 0.17), drag: 0.4, grav: -L.cell * 0.25, hue: rnd(0.4, 1), kind: 2 });
    }
  }
}

/** 棋子下方：连珠的金色光晕 */
export function drawWinUnder(p: Painter, L: Layout, now: number) {
  const t = winClock(now);
  if (t < 0 || settings.value.fx === 0) return;
  for (let pass = 0; pass < 2; pass++) {                 // 先铺一层暖色光池，再叠加提亮
    if (pass) p.blend('add');
    game.win.forEach((w, i) => {
      const dt = t - winDelay(i);
      if (dt < 0) return;
      const wave = Math.pow(0.5 + 0.5 * Math.sin(t * 2.6 - i * 0.9), 4);
      const k = Math.min(1, dt / 0.12) * (0.3 + 0.22 * wave) + 0.9 * Math.exp(-dt * 3.5);
      const c = pt(L, w.x, w.y);
      p.fxGlow(c.x, c.y, L.R * (2.3 + 0.6 * Math.exp(-dt * 3)), pass ? 0.3 : 0.75, k * (pass ? 1 : 0.45));
    });
    if (pass) p.blend('alpha');
  }
}

/** 棋子上方：点亮闪光、冲击波与涟漪。特效关闭时只用静态圆圈标出五子 */
export function drawWinOver(p: Painter, L: Layout, now: number) {
  const g = game, t = winClock(now), fx = settings.value.fx;
  const R = L.R, ringR = R * 1.105, ringW = Math.max(1.6, R * 0.055);
  if (fx === 0) {
    if (t > -1e8) for (const w of g.win) { const c = pt(L, w.x, w.y); p.fxRing(c.x, c.y, ringR, ringW, false, 0.85); }
    return;
  }
  if (t < 0) return;
  p.blend('add');
  g.win.forEach((w, i) => {
    const dt = t - winDelay(i);
    if (dt >= 0 && dt < 0.8) { const c = pt(L, w.x, w.y); p.fxGlow(c.x, c.y, R * 1.5, 0.1, 0.95 * Math.exp(-dt * 7)); }
  });
  p.blend('alpha');
  if (fx === 2) {
    const wc = winCenter(L);
    drawShockwave(p, L, wc.x, wc.y, t);
    drawLightBurst(p, L, wc.x, wc.y, t, L.board.w * 0.8);
    if (g.forfeit) return;
    // 贯穿五子的一道光：冲击时最亮，随后化作缓缓呼吸的余光
    const a = pt(L, g.win[0].x, g.win[0].y), b = pt(L, g.win[g.win.length - 1].x, g.win[g.win.length - 1].y);
    const len = Math.hypot(b.x - a.x, b.y - a.y) + R * 3;
    const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI, grow = easeOut(Math.min(t / 0.3, 1));
    const k = 0.85 * Math.exp(-t * 2.2) + 0.18 * Math.min(1, t / 0.5) * (0.6 + 0.4 * Math.sin(t * 2.6)) * Math.exp(-Math.max(t - 2.5, 0) * 1.5);
    p.blend('add');
    p.fxBeam(wc.x, wc.y, len * grow * 1.15, R * 2.4, deg, 0.35, k * 0.8);
    p.fxBeam(wc.x, wc.y, len * grow, R * 0.7, deg, 0.05, k);
    p.blend('alpha');
  }
  g.win.forEach((w, i) => {                              // 每颗连珠棋子向外扩散一圈涟漪
    const dt = t - winDelay(i);
    if (dt < 0) return;
    const c = pt(L, w.x, w.y), ph = dt / WIN_RIPPLE;
    if (ph < 1) p.fxRing(c.x, c.y, ringR * (1 + easeOut(ph) * 2.4), ringW * (1 - 0.45 * ph), false, 0.8 * Math.pow(1 - ph, 1.7));
  });
}
