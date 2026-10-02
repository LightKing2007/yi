/**
 * 全局光影：无、黄昏、晨曦、月夜、竹影五种模式。一张全屏的乘法色（明暗与色调）加一张加法光（晕光、叶隙透光、光束），
 * 着色器在约 1/3 分辨率的离屏贴图里算（左半存乘法色，右半存加法光），再分两层叠到画面上。
 * 各模式只是一组参数，切换时参数平滑过渡。
 */
import type { RenderTarget } from '../render/gl';
import type { Layout } from '../render/layout';
import type { Painter } from '../render/painter';

const SCALE = 0.34;
type Params = number[]; // 8 × vec4

/** 每行：P[0] 光源 xy、暗角、叶影强度；P[1] 近光色 + 叶影横拉伸；P[2] 远处色 + 纵拉伸；P[3] 叶影色 + 斜切；P[4] 晕光；P[5] 叶隙透光；P[6] 光束；P[7].x 竹影 */
const MODES: Params[] = [
  [0.5, 1.1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [
    -0.06, 1.1, 0.26, 1.0, 1.0, 0.95, 0.84, 1, 0.82, 0.7, 0.64, 1, 0.8, 0.78, 0.82, 0, 0.3, 0.186, 0.084, 0, 0.07, 0.052, 0.028, 0, 0.05, 0.038, 0.023, 0, 0, 0,
    0, 0,
  ],
  [
    1.06, 1.12, 0.14, 0.65, 1.0, 0.99, 0.96, 1, 0.88, 0.92, 0.98, 1, 0.86, 0.9, 0.97, 0, 0.22, 0.19, 0.15, 0, 0.045, 0.047, 0.045, 0, 0.065, 0.062, 0.055, 0, 0,
    0, 0, 0,
  ],
  [0.8, 1.16, 0.52, 0.5, 0.74, 0.78, 0.93, 1, 0.4, 0.45, 0.64, 1, 0.8, 0.82, 0.92, 0, 0.16, 0.19, 0.28, 0, 0.03, 0.036, 0.06, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [1.1, 1.25, 0.2, 1.0, 0.95, 0.98, 1.0, 1, 0.8, 0.86, 0.91, 1, 0.4, 0.49, 0.5, 0, 0.1, 0.11, 0.12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
];

// ---------------- 竹影：几枝从右上方垂下的竹枝，近处的清晰、远处的朦胧，随风轻摆 ----------------
const MAX_LEAF = 72,
  MAX_TWIG = 32;
interface Branch {
  ox: number;
  oy: number;
  ang: number;
  len: number;
  droop: number;
  scale: number;
  blur: number;
  alpha: number;
  phase: number;
}
/** 以屏高为 1、左下为原点；x 乘以屏幕宽高比 */
const BRANCHES: Branch[] = [
  { ox: 0.78, oy: 1.1, ang: 4.3, len: 0.8, droop: 0.55, scale: 1.6, blur: 0.03, alpha: 0.4, phase: 0 }, // 远处：大而模糊、淡
  { ox: 1.06, oy: 0.78, ang: 3.55, len: 0.75, droop: 0.9, scale: 1.4, blur: 0.026, alpha: 0.34, phase: 1.7 },
  { ox: 0.6, oy: 1.06, ang: 4.45, len: 0.62, droop: 0.45, scale: 1.0, blur: 0.003, alpha: 0.72, phase: 0.6 }, // 近处：清晰、深
  { ox: 0.98, oy: 1.06, ang: 3.85, len: 0.7, droop: 0.7, scale: 1.05, blur: 0.003, alpha: 0.75, phase: 2.3 },
  { ox: 1.05, oy: 0.62, ang: 3.4, len: 0.45, droop: 0.85, scale: 0.9, blur: 0.0035, alpha: 0.62, phase: 3.1 },
];
const hash1 = (i: number) => {
  const v = Math.sin(i * 12.9898 + 4.1) * 43758.5453;
  return v - Math.floor(v);
};

const LA = new Float32Array(MAX_LEAF * 4),
  LB = new Float32Array(MAX_LEAF * 4),
  TA = new Float32Array(MAX_TWIG * 4),
  TB = new Float32Array(MAX_TWIG * 4);

/** 按当前时刻摆好各枝：枝条是一条向下弯的折线（小枝），每个节上长一簇 3～5 片向下垂的披针形竹叶 */
function buildBamboo(asp: number, t: number) {
  let nl = 0,
    nt = 0;
  BRANCHES.forEach((B, b) => {
    const sway = 0.035 * Math.sin(t * 0.45 + B.phase) + 0.012 * Math.sin(t * 1.25 + B.phase * 2.1);
    let x = B.ox * asp,
      y = B.oy;
    const ang = B.ang + sway,
      segs = 5,
      segLen = B.len / segs;
    for (let k = 0; k < segs; k++) {
      const a = ang + (B.droop * (k + 0.5)) / segs;
      const nx = x + Math.cos(a) * segLen,
        ny = y + Math.sin(a) * segLen;
      if (nt < MAX_TWIG) {
        TA.set([x, y, nx, ny], nt * 4);
        TB.set([0.0016 * B.scale * (1.3 - 0.15 * k), B.blur, B.alpha * 0.85, 0], nt * 4);
        nt++;
      }
      if (k >= 1) {
        const nleaf = 3 + Math.floor(hash1(b * 31 + k) * 2.99);
        const base = a + (4.712 - a) * 0.65; // 大体向下，略顺着枝条的方向
        for (let j = 0; j < nleaf && nl < MAX_LEAF; j++) {
          const id = b * 97 + k * 13 + j;
          const spread = (j - (nleaf - 1) * 0.5) / (nleaf > 1 ? nleaf - 1 : 1);
          const la = base + spread * 1.5 + (hash1(id) - 0.5) * 0.25 + 0.05 * Math.sin(t * 1.6 + id * 0.9);
          const len = (0.1 + 0.07 * hash1(id + 7)) * B.scale * (0.85 + 0.05 * k);
          LA.set([nx, ny, la, len], nl * 4);
          LB.set([len * (0.075 + 0.025 * hash1(id + 11)), B.blur, B.alpha * (0.8 + 0.2 * hash1(id + 5)), 0], nl * 4);
          nl++;
        }
      }
      x = nx;
      y = ny;
    }
  });
  return { nl, nt };
}

export class Light {
  private cur: Params | null = null;
  private rt: RenderTarget | null = null;
  private w = 0;
  private h = 0;
  private last = 0;
  /** 切换光影模式时的过渡快慢（每秒） */
  blendRate = 5;
  constructor(private p: Painter) {}

  private blendParams(mode: number, dt: number) {
    const to = MODES[mode > 0 && mode < MODES.length ? mode : 1];
    if (!this.cur) {
      this.cur = to.slice();
      return;
    }
    const a = 1 - Math.exp(-dt * this.blendRate);
    for (let i = 0; i < 32; i++) this.cur[i] += (to[i] - this.cur[i]) * a;
  }

  /** 在一帧开画之前把光影算进离屏贴图 */
  prepare(L: Layout, sw: number, sh: number, now: number, k: number, mode: number) {
    const dt = this.last > 0 ? Math.min(now - this.last, 0.1) : 0;
    this.last = now;
    this.blendParams(mode, dt);
    if (k <= 0.001) return;
    const p = this.p,
      g = p.g,
      s = g.dpr * SCALE;
    const w = Math.ceil(sw * s),
      h = Math.ceil(sh * s);
    this.rt = g.createTarget(2 * w, h, this.rt);
    this.w = w;
    this.h = h;
    const P = L.panel,
      cur = this.cur!;
    const t = now % 1000;
    const d = p.dusk;
    d.set('res', [w, h]);
    d.set('board', [L.board.x * s, (sh - L.board.y - L.board.h) * s, L.board.w * s, L.board.h * s]);
    d.set('panel', [(P.x - 24 * L.u) * s, (sh - P.y - P.h - 24 * L.u) * s, (P.w + 48 * L.u) * s, (P.h + 48 * L.u) * s]);
    d.set('time', t);
    d.set('k', k);
    g.use(d);
    const gl = g.gl;
    gl.uniform4fv(d.loc('P'), new Float32Array(cur));
    const on = cur[28] > 0.001,
      bb = on ? buildBamboo(w / h, t) : { nl: 0, nt: 0 };
    gl.uniform4fv(d.loc('LA'), LA);
    gl.uniform4fv(d.loc('LB'), LB);
    gl.uniform4fv(d.loc('TA'), TA);
    gl.uniform4fv(d.loc('TB'), TB);
    gl.uniform1i(d.loc('leafN'), bb.nl);
    gl.uniform1i(d.loc('twigN'), bb.nt);
    g.begin(this.rt, null);
    g.setBlend('replace');
    g.use(d);
    g.quad(0, 0, 2 * w, h, [1, 1, 1, 1]);
    g.end();
  }

  /** 叠到画面上：先乘色调，再加光 */
  draw(sw: number, sh: number, k: number) {
    if (k <= 0.001 || !this.rt) return;
    const p = this.p,
      g = p.g,
      m = p.duskMix;
    g.bindTexture(0, this.rt.tex);
    m.set('dusk', 0, 'i');
    m.set('texel', [0.5 / this.w, 0.5 / this.h]);
    g.setBlend('multiply');
    g.use(m);
    g.quad(0, 0, sw, sh, [1, 1, 1, 1], [0, 0, 0, 0]);
    g.setBlend('add');
    g.quad(0, 0, sw, sh, [1, 1, 1, 1], [1, 0, 0, 0]);
    g.setBlend('alpha');
  }
}
