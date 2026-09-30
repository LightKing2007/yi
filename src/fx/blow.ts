/** 五子棋取胜后其余棋子被炸飞：带碰撞的物理模拟录像、立体翻滚、倒放查看 */
import { game, boardView } from '../app/state';
import { settings } from '../app/settings';
import { GameType, MAXN } from '../core/types';
import { pt, type Layout } from '../render/layout';
import { matMul3, rotAxis, type Mat3, type Painter } from '../render/painter';
import { emit, rnd, waveArrival, winClock } from './fx';
import { winIndex } from './gomokuWin';

const BLOW_END = 2.6;      // 单颗棋子飞出并消失所需时间
const BLOW_FADE = 1.0;     // 起飞多久后开始淡出
const BLOW_HZ = 60;        // 录像采样率
const BLOW_MAXS = 240;     // 最多 4 秒
const BLOW_DRAG = 1.1;     // 平面速度的指数衰减

/** 炸飞时留在盘上的子：连珠五子；认输等结束时是胜方全部的子 */
export const staysOnBoard = (x: number, y: number) => winIndex(x, y) >= 0 || (game.forfeit && game.b(x, y) === game.winner);

export function blowing() {
  const g = game;
  return settings.value.fx === 2 && g.type === GameType.Gomoku && g.over && g.winner !== 3 && boardView.winT > 0 && (g.win.length >= 5 || g.forfeit);
}

/** 由棋子自身的随机种子派生的确定性随机数，保证倒放时轨迹一致 */
function seedRnd(x: number, y: number, k: number) {
  const v = Math.sin((boardView.seed[x * MAXN + y] + 1) * 12.9898 + (x * 19 + y) * 4.1414 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

function winMid() { const w = game.win; return { x: (w[0].x + w[w.length - 1].x) / 2, y: (w[0].y + w[w.length - 1].y) / 2 }; }

/** 冲击波（从连珠中心出发）扫到交叉点的时刻 */
function blowStart(gx: number, gy: number) { const m = winMid(); return waveArrival(gx, gy, m.x, m.y); }

/** 起飞方向：远离连珠线段，带一点随机偏角 */
function blowAngle(x: number, y: number) {
  const w = game.win, ax = w[0].x, ay = w[0].y, bx = w[w.length - 1].x - ax, by = w[w.length - 1].y - ay;
  const L2 = bx * bx + by * by;
  const h = L2 > 0 ? Math.min(Math.max(((x - ax) * bx + (y - ay) * by) / L2, 0), 1) : 0;
  return Math.atan2(y - (ay + by * h), x - (ax + bx * h)) + (seedRnd(x, y, 1) - 0.5) * 0.6;
}

/** 飞行轨迹：胜利时一次性做带碰撞的物理模拟并录下来，绘制与“查看棋局”的倒放都按录像回放 */
const sim = {
  forWinT: -1,
  samples: 0,
  t0: new Float32Array(MAXN * MAXN),
  path: new Float32Array(MAXN * MAXN * BLOW_MAXS * 2),
};

function simulate() {
  const g = game;
  interface Body { x: number; y: number; fixed: boolean; launched: boolean; px: number; py: number; vx: number; vy: number; lx: number; ly: number }
  const b: Body[] = [];
  let tend = 0;
  for (let x = 0; x < g.N; x++) for (let y = 0; y < g.N; y++) {
    if (!g.b(x, y)) continue;
    const keep = staysOnBoard(x, y);                     // 连珠（认输时是胜方的子）不动，当作障碍
    const o: Body = { x, y, fixed: keep, launched: false, px: x, py: y, vx: 0, vy: 0, lx: 0, ly: 0 };
    sim.t0[x * MAXN + y] = blowStart(x, y);
    b.push(o);
    if (keep) continue;
    const ang = blowAngle(x, y), sp = seedRnd(x, y, 2), v0 = 7 + 17 * sp * sp;
    o.lx = Math.cos(ang) * v0; o.ly = Math.sin(ang) * v0;
    tend = Math.max(tend, sim.t0[x * MAXN + y] + BLOW_END);
  }
  sim.samples = Math.floor(Math.min(BLOW_MAXS, tend * BLOW_HZ + 2));
  const n = b.length, ord = b.map((_, i) => i);
  const sub = 4, h = 1 / (BLOW_HZ * sub), D = 2 * 0.482 + 0.04, keep = Math.exp(-BLOW_DRAG * h);
  for (let s = 0; s < sim.samples; s++) {
    for (const o of b) { const i = ((o.x * MAXN + o.y) * BLOW_MAXS + s) * 2; sim.path[i] = o.px; sim.path[i + 1] = o.py; }
    for (let k = 0; k < sub; k++) {
      const t = (s * sub + k) * h;
      for (const o of b) {
        if (o.fixed) continue;
        if (!o.launched && t >= sim.t0[o.x * MAXN + o.y]) { o.vx += o.lx; o.vy += o.ly; o.launched = true; }
        o.vx *= keep; o.vy *= keep;
        o.px += o.vx * h; o.py += o.vy * h;
      }
      // 圆与圆的碰撞：推开重叠，按恢复系数交换法向速度。按 x 排序后只比较 x 相距不到一个直径的对
      for (let a = 1; a < n; a++) {
        const v = ord[a];
        let c = a;
        while (c > 0 && b[ord[c - 1]].px > b[v].px) { ord[c] = ord[c - 1]; c--; }
        ord[c] = v;
      }
      for (let a = 0; a < n; a++) for (let e = a + 1; e < n && b[ord[e]].px - b[ord[a]].px < D; e++) {
        const bi = b[ord[a]], bj = b[ord[e]];
        if (bi.fixed && bj.fixed) continue;
        const dx = bj.px - bi.px, dy = bj.py - bi.py, d2 = dx * dx + dy * dy;
        if (d2 >= D * D || d2 < 1e-8) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, over = D - d;
        const wi = bi.fixed ? 0 : 1, wj = bj.fixed ? 0 : 1, ws = wi + wj;
        bi.px -= (nx * over * wi) / ws; bi.py -= (ny * over * wi) / ws;
        bj.px += (nx * over * wj) / ws; bj.py += (ny * over * wj) / ws;
        const vn = (bj.vx - bi.vx) * nx + (bj.vy - bi.vy) * ny;
        if (vn >= 0) continue;
        const imp = (-(1 + 0.55) * vn) / ws;
        bi.vx -= nx * imp * wi; bi.vy -= ny * imp * wi;
        bj.vx += nx * imp * wj; bj.vy += ny * imp * wj;
      }
    }
  }
  sim.forWinT = boardView.winT;
}

export function ensureBlowSim() { if (blowing() && sim.forWinT !== boardView.winT) simulate(); }

/** 整场爆炸的播放时间：正常随时钟前进，“查看棋局”时倒放回 0 */
function blowTime(now: number) {
  let v = boardView.blowView; v = v * v * (3 - 2 * v);
  return Math.min(Math.max(winClock(now), 0), (sim.samples - 1) / BLOW_HZ) * v;
}

interface Debris { x: number; y: number; cx: number; cy: number; r: number; z: number; alpha: number; deg: number; tilt: number; rot: Mat3 }
const I3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** 计算被炸飞棋子当前的位置、翻滚与透明度；不可见时返回 null */
function debrisAt(L: Layout, now: number, x: number, y: number): Debris | null {
  const p0 = pt(L, x, y);
  const o: Debris = { x, y, cx: p0.x, cy: p0.y, r: L.R, z: 0, alpha: 1, deg: 0, tilt: 0, rot: I3 };
  if (sim.forWinT !== boardView.winT) return o;
  const T = blowTime(now), f = T * BLOW_HZ;
  const i0 = Math.floor(Math.min(f, sim.samples - 1)), i1 = i0 + 1 < sim.samples ? i0 + 1 : i0, u = f - i0;
  const base = (x * MAXN + y) * BLOW_MAXS;
  const gx = sim.path[(base + i0) * 2] + (sim.path[(base + i1) * 2] - sim.path[(base + i0) * 2]) * u;
  const gy = sim.path[(base + i0) * 2 + 1] + (sim.path[(base + i1) * 2 + 1] - sim.path[(base + i0) * 2 + 1]) * u;
  o.cx = L.ox + gx * L.cell; o.cy = L.oy + gy * L.cell;
  const tau = T - sim.t0[x * MAXN + y];
  if (tau <= 0) return o;
  const ang = blowAngle(x, y), vz = 3 + 2 * seedRnd(x, y, 3);
  const z = Math.max(0, vz * tau - 5 * tau * tau);        // 抛起的高度（以棋子半径计）
  o.cy -= z * L.R * 0.35;
  o.r = L.R * (1 + 0.16 * z);
  o.z = z;
  o.deg = (ang * 180) / Math.PI;                          // 沿飞行方向向前翻滚，叠加一点绕自身轴的自转
  o.tilt = (1 + 2.2 * seedRnd(x, y, 4)) * tau * (seedRnd(x, y, 5) < 0.5 ? -1 : 1);
  o.rot = matMul3(rotAxis(-Math.sin(ang), -Math.cos(ang), 0, o.tilt), rotAxis(0, 0, 1, (seedRnd(x, y, 6) - 0.5) * 2 * tau));
  let fo = Math.min(Math.max((tau - BLOW_FADE) / (BLOW_END - BLOW_FADE), 0), 1);
  fo = fo * fo * (3 - 2 * fo);
  o.alpha = 1 - fo;
  o.r *= 1 - 0.35 * fo;                                   // 淡出时同时缩小，像是远去而不是变成半透明残影
  return o.alpha > 0.01 ? o : null;
}

let debris: Debris[] = [];

/** 本帧所有被炸飞棋子的状态，按高度从低到高排好（飞得高的后画） */
export function buildDebris(L: Layout, now: number) {
  debris = [];
  if (!blowing()) return;
  const g = game;
  for (let x = 0; x < g.N; x++) for (let y = 0; y < g.N; y++) {
    if (!g.b(x, y) || staysOnBoard(x, y)) continue;
    const d = debrisAt(L, now, x, y);
    if (d) debris.push(d);
  }
  debris.sort((a, b) => a.z - b.z);
}

/** shadows 画影子否则画棋子；flying=false 只画还在盘上的，true 只画飞在空中的（画在界面之上） */
export function drawDebris(p: Painter, L: Layout, shadows: boolean, flying: boolean) {
  const g = game;
  for (const d of debris) {
    if ((d.tilt !== 0) !== flying) continue;
    const c = g.b(d.x, d.y), seed = boardView.seed[d.x * MAXN + d.y];
    if (shadows) {                                        // 影子是椭球在盘面上的投影
      const ct = Math.cos(d.tilt), st = Math.sin(d.tilt), along = d.r * Math.sqrt(ct * ct + 0.277 * st * st);
      p.stoneShadowE(d.cx + L.R * (0.1 + 0.3 * d.z), d.cy + L.R * (0.16 + 0.55 * d.z), along, d.r, d.deg, d.alpha / (1 + 0.8 * d.z));
    } else if (d.tilt === 0) p.stone(d.cx, d.cy, d.r, c, seed, d.alpha);
    else p.stone3D(d.cx, d.cy, d.r, c, seed, d.alpha, d.rot);
  }
}

/** 被炸飞时在原位扬起的一点木屑光尘（随冲击波依次出现） */
export function emitBlowDust(L: Layout, now: number) {
  const g = game;
  for (let x = 0; x < g.N; x++) for (let y = 0; y < g.N; y++) {
    if (!g.b(x, y) || staysOnBoard(x, y)) continue;
    const p = pt(L, x, y), t0 = now + blowStart(x, y);
    for (let k = 0; k < 4; k++) {
      const ang = rnd(0, 6.2832), sp = L.cell * rnd(1.5, 5);
      emit({ x: p.x, y: p.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, t0, life: rnd(0.35, 0.7), size: L.cell * rnd(0.07, 0.12), drag: 3.5, grav: L.cell * 3, hue: rnd(0.4, 1), kind: 1 });
    }
  }
}
