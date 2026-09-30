/** 围棋“胜负揭晓”：冲击波自棋盘中心扫过，死子化光散去，领地逐点亮起，胜方棋子依次闪耀 */
import { game, boardView } from '../app/state';
import { settings } from '../app/settings';
import { sfx } from '../audio';
import { MAXN, WHITE } from '../core/types';
import { pt, type Layout } from '../render/layout';
import type { Painter } from '../render/painter';
import { drawLightBurst, drawShockwave, emit, goEndClock, rnd, waveArrival } from './fx';

const GO_DISSOLVE = 0.7;   // 死子化去所需时间

export function goArrival(x: number, y: number) { const c = (game.N - 1) / 2; return waveArrival(x, y, c, c); }

/** 该点是否属于胜方：胜方活子，或胜方的地 */
function winnerOwns(x: number, y: number) {
  const g = game, s = g.b(x, y), i = x * MAXN + y;
  if (s) return s === g.winner && !g.dead[i];
  return g.terr[i] === g.winner;
}

/** 死子化去的进度 0..1；不在揭晓动画中或不是死子时返回 -1 */
export function goDeadFade(x: number, y: number, now: number) {
  const t = goEndClock(now);
  if (t < -1e8 || !game.dead[x * MAXN + y]) return -1;
  if (settings.value.fx === 0) return 1;
  return Math.min(Math.max((t - goArrival(x, y)) / GO_DISSOLVE, 0), 1);
}

/** 胜方棋子被冲击波扫到时的轻弹缩放 */
export function goWinPop(x: number, y: number, now: number) {
  const g = game, t = goEndClock(now);
  if (t < 0 || settings.value.fx === 0 || g.b(x, y) !== g.winner || g.dead[x * MAXN + y]) return 1;
  const u = (t - goArrival(x, y)) / 0.32;
  return u > 0 && u < 1 ? 1 + 0.12 * Math.sin(u * Math.PI) * (1 - u) : 1;
}

export function goEndUpdate(L: Layout, now: number, dt: number) {
  const g = game, t = goEndClock(now), fx = settings.value.fx;
  if (t < 0) return;
  const cell = L.cell;
  if (!boardView.goBurst) { boardView.goBurst = 1; if (fx >= 1) { sfx.play('goend'); sfx.duck(); } }
  if (fx < 2) return;
  if (boardView.goBurst === 1) {
    boardView.goBurst = 2;
    for (let x = 0; x < g.N; x++) for (let y = 0; y < g.N; y++) {
      const s = g.b(x, y);
      if (!s) continue;
      const p = pt(L, x, y), t0 = now + goArrival(x, y);
      if (g.dead[x * MAXN + y]) {                        // 死子化作光尘缓缓升起
        for (let k = 0; k < 12; k++) {
          const ang = rnd(0, 6.2832), r = Math.random() * L.R;
          emit({ x: p.x + Math.cos(ang) * r, y: p.y + Math.sin(ang) * r, vx: Math.cos(ang) * cell * rnd(0.3, 1.2), vy: -cell * rnd(0.6, 1.8),
            t0: t0 + rnd(0, 0.35), life: rnd(0.7, 1.3), size: cell * rnd(0.1, 0.2), drag: 1.5, grav: -cell * 0.3, hue: s === WHITE ? rnd(0, 0.3) : rnd(0.6, 1), kind: 0 });
        }
      } else if (s === g.winner) {                       // 胜方棋子溅起几点火花
        for (let k = 0; k < 3; k++) {
          const ang = rnd(0, 6.2832), sp = cell * rnd(3, 8);
          emit({ x: p.x + Math.cos(ang) * L.R * 0.7, y: p.y + Math.sin(ang) * L.R * 0.7, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - cell,
            t0, life: rnd(0.4, 0.8), size: cell * rnd(0.09, 0.15), drag: 3, grav: cell * 6, hue: rnd(0.3, 1), kind: 1 });
        }
      }
    }
  }
  if (t > 0.3 && t < 3.6) {                              // 胜方的棋子与领地上持续升起余烬
    const rate = 44 * (1 - t / 3.6) + 8, n = Math.floor(rate * dt + Math.random());
    for (let k = 0; k < n; k++) for (let tries = 0; tries < 8; tries++) {
      const x = Math.floor(Math.random() * g.N), y = Math.floor(Math.random() * g.N);
      if (!winnerOwns(x, y)) continue;
      const p = pt(L, x, y);
      emit({ x: p.x + rnd(-1, 1) * L.R, y: p.y + rnd(-1, 1) * L.R, vx: rnd(-0.3, 0.3) * cell, vy: -cell * rnd(0.5, 1.3),
        t0: now, life: rnd(1.4, 2.6), size: cell * rnd(0.08, 0.15), drag: 0.4, grav: -cell * 0.25, hue: rnd(0.4, 1), kind: 2 });
      break;
    }
  }
}

/** 棋子下方：胜方棋子与领地的金色光晕，此后一圈圈光波从中心向外流过 */
export function drawGoEndUnder(p: Painter, L: Layout, now: number) {
  const g = game, t = goEndClock(now);
  if (t < 0 || settings.value.fx === 0) return;
  const c = (g.N - 1) / 2;
  for (let pass = 0; pass < 2; pass++) {
    if (pass) p.blend('add');
    for (let x = 0; x < g.N; x++) for (let y = 0; y < g.N; y++) {
      if (!winnerOwns(x, y)) continue;
      const da = t - goArrival(x, y);
      if (da < 0) continue;
      const dist = Math.hypot(x - c, y - c);
      const wave = Math.pow(0.5 + 0.5 * Math.sin(t * 2.4 - dist * 0.55), 6) * Math.min(1, da / 0.3);
      const stone = g.b(x, y) !== 0;
      const k = stone ? Math.min(1, da / 0.15) * (0.22 + 0.25 * wave) + 0.9 * Math.exp(-da * 3) : Math.min(1, da / 0.15) * (0.16 + 0.25 * wave) + 0.8 * Math.exp(-da * 3);
      const q = pt(L, x, y);
      p.fxGlow(q.x, q.y, L.R * (stone ? 2 : 1.5), pass ? 0.3 : 0.75, k * (pass ? 0.8 : 0.4));
    }
    if (pass) p.blend('alpha');
  }
}

/** 棋子与领地标记上方：冲击波与扫过时的闪光 */
export function drawGoEndOver(p: Painter, L: Layout, now: number) {
  const g = game, t = goEndClock(now);
  if (t < 0 || settings.value.fx === 0) return;
  const c = (g.N - 1) / 2;
  for (let pass = 0; pass < 2; pass++) {
    if (pass) p.blend('add');
    for (let x = 0; x < g.N; x++) for (let y = 0; y < g.N; y++) {
      if (!winnerOwns(x, y)) continue;
      const da = t - goArrival(x, y);
      if (da < 0 || da > 0.8) continue;
      const q = pt(L, x, y);
      p.fxGlow(q.x, q.y, L.R * (g.b(x, y) ? 1.5 : 1), pass ? 0.1 : 0.7, (pass ? 0.9 : 0.45) * Math.exp(-da * 6));
    }
    if (pass) p.blend('alpha');
  }
  if (settings.value.fx === 2) {
    const cx = L.ox + c * L.cell, cy = L.oy + c * L.cell;
    drawShockwave(p, L, cx, cy, t);
    drawLightBurst(p, L, cx, cy, t, L.board.w * 0.7);
  }
}
