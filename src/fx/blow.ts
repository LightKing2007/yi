/**
 * 五子棋取胜后其余棋子被炸飞：带碰撞的物理模拟录像、立体翻滚、倒放查看。
 * 棋子是有分量的石头：重力很大，所以抛得不高、落得快；落地后像弹珠一样再弹一两下、一次比一次低，
 * 每段飞行正好翻整数个半圈、落地时平放；贴着盘面时摩擦很大，很快停下。起飞后不久就开始淡去，在飞散的过程中慢慢消失。
 */
import { game, boardView } from '../app/state';
import { settings } from '../app/settings';
import { GameType, MAXN } from '../core/types';
import { pt, type Layout } from '../render/layout';
import { matMul3, rotAxis, type Mat3, type Painter } from '../render/painter';
import { emit, rnd, waveArrival, winClock, winEnds, winIndex } from './fx';

const BLOW_END = 1.15; // 起飞后多久完全消失（这时差不多刚停下）
const BLOW_FADE = 0.2; // 起飞多久后开始淡出：在飞散的过程中慢慢消失
const BLOW_HZ = 60; // 录像采样率
const BLOW_MAXS = 240; // 最多 4 秒
// 力度与分量（水平以格计，竖直以棋子半径计）
const V0 = 12,
  V0_RND = 4; // 起飞的水平速度：12～16 格 / 秒，只带一点随机
const AIR_DRAG = 0.5; // 在空中时水平速度的指数衰减
const GROUND_FRICTION = 18; // 贴着盘面时的摩擦减速（格 / 秒²）
const LAND_KEEP = 0.8; // 每次落地水平速度保留的比例
const GRAVITY = 40; // 重力（棋子半径 / 秒²）
const VZ0 = 4.5,
  VZ0_RND = 6; // 起飞的竖直速度（棋子半径 / 秒）：4.5～10.5，有的贴着盘面飞，有的抛得很高
const BOUNCE = 0.42,
  BOUNCE_MIN = 1.2; // 落地反弹保留的竖直速度比例；低于 BOUNCE_MIN 就不再弹
const E_STONE = 0.4; // 棋子之间碰撞的恢复系数（石头碰石头，不太弹）
const LIFT = 0.6; // 画的时候高度换算成往上偏移（棋子半径）

/** 一段飞行：起飞时刻（相对起飞）、时长、竖直初速、翻几个半圈 */
interface Hop {
  t: number;
  T: number;
  vz: number;
  flips: number;
}

/** 某颗棋子起飞后的全部飞行段（由它的随机种子决定，绘制与模拟共用） */
function hops(x: number, y: number): Hop[] {
  const out: Hop[] = [];
  let vz = VZ0 + VZ0_RND * seedRnd(x, y, 3),
    t = 0,
    first = true;
  while (vz >= BOUNCE_MIN && out.length < 4) {
    const T = (2 * vz) / GRAVITY;
    const flips = first ? 1 + Math.floor(seedRnd(x, y, 4) * 2) : vz > 2.5 ? 1 : 0;
    out.push({ t, T, vz, flips });
    t += T;
    vz *= BOUNCE;
    first = false;
  }
  return out;
}

/** 炸飞时留在盘上的子：连珠五子；认输等结束时是胜方全部的子 */
export const staysOnBoard = (x: number, y: number) => winIndex(x, y) >= 0 || (game.forfeit && game.b(x, y) === game.winner);

export function blowing() {
  const g = game;
  return settings.value.fx === 2 && g.type === GameType.Gomoku && g.over && g.winner !== 3 && boardView.winT > 0 && (g.win.length >= 5 || g.forfeit);
}

/** 由棋子自身的随机种子派生的确定性随机数，保证倒放时轨迹一致 */
function seedRnd(x: number, y: number, k: number) {
  const v = Math.sin((boardView.seedAt(x, y) + 1) * 12.9898 + (x * 19 + y) * 4.1414 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

function winMid() {
  const { first, last } = winEnds();
  return { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
}

/** 冲击波（从连珠中心出发）扫到交叉点的时刻 */
function blowStart(gx: number, gy: number) {
  const m = winMid();
  return waveArrival(gx, gy, m.x, m.y);
}

/** 起飞方向：远离连珠线段，带一点随机偏角 */
function blowAngle(x: number, y: number) {
  const { first, last } = winEnds(),
    ax = first.x,
    ay = first.y,
    bx = last.x - ax,
    by = last.y - ay;
  const L2 = bx * bx + by * by;
  const h = L2 > 0 ? Math.min(Math.max(((x - ax) * bx + (y - ay) * by) / L2, 0), 1) : 0;
  return Math.atan2(y - (ay + by * h), x - (ax + bx * h)) + (seedRnd(x, y, 1) - 0.5) * 0.6;
}

/** (x, y) 处棋子的起飞时刻（相对连珠时刻）；坐标在棋盘内，取不到时的 0 只为满足类型检查 */
const launchAt = (x: number, y: number) => sim.t0[x * MAXN + y] ?? 0;
/** 录像中 base 起第 k 帧的坐标分量（axis 为 0 取 x，为 1 取 y）；帧号小于录像长度 */
const recorded = (base: number, k: number, axis: number) => sim.path[(base + k) * 2 + axis] ?? 0;

/** 飞行轨迹：胜利时一次性做带碰撞的物理模拟并录下来，绘制与“查看棋局”的倒放都按录像回放 */
const sim = {
  forWinT: -1,
  samples: 0,
  t0: new Float32Array(MAXN * MAXN),
  path: new Float32Array(MAXN * MAXN * BLOW_MAXS * 2),
};

function simulate() {
  const g = game;
  interface Body {
    x: number;
    y: number;
    fixed: boolean;
    launched: boolean;
    px: number;
    py: number;
    vx: number;
    vy: number;
    lx: number;
    ly: number;
    lands: number[];
    air: number;
    landed: number;
  }
  const b: Body[] = [];
  let tend = 0;
  for (let x = 0; x < g.N; x++)
    for (let y = 0; y < g.N; y++) {
      if (!g.b(x, y)) continue;
      const keep = staysOnBoard(x, y); // 连珠（认输时是胜方的子）不动，当作障碍
      const o: Body = { x, y, fixed: keep, launched: false, px: x, py: y, vx: 0, vy: 0, lx: 0, ly: 0, lands: [], air: 0, landed: 0 };
      sim.t0[x * MAXN + y] = blowStart(x, y);
      b.push(o);
      if (keep) continue;
      const ang = blowAngle(x, y),
        v0 = V0 + V0_RND * seedRnd(x, y, 2);
      o.lx = Math.cos(ang) * v0;
      o.ly = Math.sin(ang) * v0;
      const hs = hops(x, y);
      o.lands = hs.map(hh => hh.t + hh.T);
      o.air = o.lands[o.lands.length - 1] ?? 0;
      tend = Math.max(tend, launchAt(x, y) + BLOW_END);
    }
  sim.samples = Math.floor(Math.min(BLOW_MAXS, tend * BLOW_HZ + 2));
  const ord = b.slice(); // 按 x 排序的棋子
  const sub = 4,
    h = 1 / (BLOW_HZ * sub),
    D = 2 * 0.482 + 0.04,
    airKeep = Math.exp(-AIR_DRAG * h);
  for (let s = 0; s < sim.samples; s++) {
    for (const o of b) {
      const i = ((o.x * MAXN + o.y) * BLOW_MAXS + s) * 2;
      sim.path[i] = o.px;
      sim.path[i + 1] = o.py;
    }
    for (let k = 0; k < sub; k++) {
      const t = (s * sub + k) * h;
      for (const o of b) {
        if (o.fixed) continue;
        if (!o.launched && t >= launchAt(o.x, o.y)) {
          o.vx += o.lx;
          o.vy += o.ly;
          o.launched = true;
        }
        if (o.launched) {
          const tau = t - launchAt(o.x, o.y);
          while (o.landed < o.lands.length && tau >= (o.lands[o.landed] ?? Infinity)) {
            o.vx *= LAND_KEEP;
            o.vy *= LAND_KEEP;
            o.landed++;
          } // 每次落地都损失一些速度
          if (tau < o.air) {
            o.vx *= airKeep;
            o.vy *= airKeep;
          } else {
            // 贴着盘面：摩擦很大，很快停下
            const sp = Math.hypot(o.vx, o.vy),
              dec = GROUND_FRICTION * h;
            if (sp <= dec) o.vx = o.vy = 0;
            else {
              o.vx -= (o.vx / sp) * dec;
              o.vy -= (o.vy / sp) * dec;
            }
          }
        }
        o.px += o.vx * h;
        o.py += o.vy * h;
      }
      // 圆与圆的碰撞：推开重叠，按恢复系数交换法向速度。按 x 排序后只比较 x 相距不到一个直径的对
      ord.sort((p, q) => p.px - q.px); // 稳定排序，与上一步的次序几乎相同
      for (const [a, bi] of ord.entries())
        for (let e = a + 1, bj = ord[e]; bj && bj.px - bi.px < D; bj = ord[++e]) {
          if (bi.fixed && bj.fixed) continue;
          const dx = bj.px - bi.px,
            dy = bj.py - bi.py,
            d2 = dx * dx + dy * dy;
          if (d2 >= D * D || d2 < 1e-8) continue;
          const d = Math.sqrt(d2),
            nx = dx / d,
            ny = dy / d,
            over = D - d;
          const wi = bi.fixed ? 0 : 1,
            wj = bj.fixed ? 0 : 1,
            ws = wi + wj;
          bi.px -= (nx * over * wi) / ws;
          bi.py -= (ny * over * wi) / ws;
          bj.px += (nx * over * wj) / ws;
          bj.py += (ny * over * wj) / ws;
          const vn = (bj.vx - bi.vx) * nx + (bj.vy - bi.vy) * ny;
          if (vn >= 0) continue;
          const imp = (-(1 + E_STONE) * vn) / ws;
          bi.vx -= nx * imp * wi;
          bi.vy -= ny * imp * wi;
          bj.vx += nx * imp * wj;
          bj.vy += ny * imp * wj;
        }
    }
  }
  sim.forWinT = boardView.winT;
}

export function ensureBlowSim() {
  if (blowing() && sim.forWinT !== boardView.winT) simulate();
}

/** 整场爆炸的播放时间：正常随时钟前进，“查看棋局”时倒放回 0 */
function blowTime(now: number) {
  let v = boardView.blowView;
  v = v * v * (3 - 2 * v);
  return Math.min(Math.max(winClock(now), 0), (sim.samples - 1) / BLOW_HZ) * v;
}

interface Debris {
  x: number;
  y: number;
  cx: number;
  cy: number;
  r: number;
  z: number;
  alpha: number;
  deg: number;
  tilt: number;
  rot: Mat3;
  up: boolean;
}
const I3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** 计算被炸飞棋子当前的位置、翻滚与透明度；不可见时返回 null */
function debrisAt(L: Layout, now: number, x: number, y: number): Debris | null {
  const p0 = pt(L, x, y);
  const o: Debris = { x, y, cx: p0.x, cy: p0.y, r: L.R, z: 0, alpha: 1, deg: 0, tilt: 0, rot: I3, up: false };
  if (sim.forWinT !== boardView.winT) return o;
  const T = blowTime(now),
    f = T * BLOW_HZ;
  const i0 = Math.floor(Math.min(f, sim.samples - 1)),
    i1 = i0 + 1 < sim.samples ? i0 + 1 : i0,
    u = f - i0;
  const base = (x * MAXN + y) * BLOW_MAXS;
  const gx = recorded(base, i0, 0) + (recorded(base, i1, 0) - recorded(base, i0, 0)) * u;
  const gy = recorded(base, i0, 1) + (recorded(base, i1, 1) - recorded(base, i0, 1)) * u;
  o.cx = L.ox + gx * L.cell;
  o.cy = L.oy + gy * L.cell;
  const tau = T - launchAt(x, y);
  if (tau <= 0) return o;
  o.up = true; // 起飞以后就画在上层（盖在界面之上）
  const ang = blowAngle(x, y),
    dir = seedRnd(x, y, 5) < 0.5 ? -1 : 1;
  let z = 0,
    tilt = 0;
  for (const hh of hops(x, y)) {
    // 在第几段飞行里：抛物线高度，翻整数个半圈
    const u = (tau - hh.t) / hh.T;
    if (u < 0 || u >= 1) continue;
    const s = tau - hh.t;
    z = Math.max(0, hh.vz * s - 0.5 * GRAVITY * s * s);
    tilt = dir * (hh.flips * Math.PI * u + (hh.flips ? 0 : (0.35 * Math.sin(Math.PI * u) * hh.vz) / 2.5));
    break;
  }
  o.cy -= z * L.R * LIFT;
  o.r = L.R * (1 + 0.12 * z);
  o.z = z;
  o.deg = (ang * 180) / Math.PI; // 沿飞行方向向前翻滚，自身轴的自转很快停下
  o.tilt = tilt;
  const spin = (seedRnd(x, y, 6) - 0.5) * 2 * (1 - Math.exp(-tau * 3));
  o.rot = matMul3(rotAxis(-Math.sin(ang), -Math.cos(ang), 0, tilt), rotAxis(0, 0, 1, spin));
  let fo = Math.min(Math.max((tau - BLOW_FADE) / (BLOW_END - BLOW_FADE), 0), 1);
  fo = fo * fo * (3 - 2 * fo);
  o.alpha = 1 - fo;
  o.r *= 1 - 0.35 * fo; // 淡出时同时缩小，像是远去而不是变成半透明残影
  return o.alpha > 0.01 ? o : null;
}

let debris: Debris[] = [];

/** 本帧所有被炸飞棋子的状态，按高度从低到高排好（飞得高的后画） */
export function buildDebris(L: Layout, now: number) {
  debris = [];
  if (!blowing()) return;
  const g = game;
  for (let x = 0; x < g.N; x++)
    for (let y = 0; y < g.N; y++) {
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
    if (d.up !== flying) continue;
    const c = g.b(d.x, d.y),
      seed = boardView.seedAt(d.x, d.y);
    if (shadows) {
      // 影子是椭球在盘面上的投影
      const ct = Math.cos(d.tilt),
        st = Math.sin(d.tilt),
        along = d.r * Math.sqrt(ct * ct + 0.277 * st * st);
      p.stoneShadowE(d.cx + L.R * (0.1 + 0.3 * d.z), d.cy + L.R * (0.16 + (LIFT + 0.2) * d.z), along, d.r, d.deg, d.alpha / (1 + 0.8 * d.z));
    } else if (d.tilt === 0) p.stone(d.cx, d.cy, d.r, c, seed, d.alpha);
    else p.stone3D(d.cx, d.cy, d.r, c, seed, d.alpha, d.rot);
  }
}

/** 被炸飞时在原位扬起的一点木屑光尘（随冲击波依次出现） */
export function emitBlowDust(L: Layout, now: number) {
  const g = game;
  for (let x = 0; x < g.N; x++)
    for (let y = 0; y < g.N; y++) {
      if (!g.b(x, y) || staysOnBoard(x, y)) continue;
      const p = pt(L, x, y),
        t0 = now + blowStart(x, y);
      for (let k = 0; k < 4; k++) {
        const ang = rnd(0, 6.2832),
          sp = L.cell * rnd(1.5, 5);
        emit({
          x: p.x,
          y: p.y,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          t0,
          life: rnd(0.35, 0.7),
          size: L.cell * rnd(0.07, 0.12),
          drag: 3.5,
          grav: L.cell * 3,
          hue: rnd(0.4, 1),
          kind: 1,
        });
      }
    }
}
