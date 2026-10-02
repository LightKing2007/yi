/** 绘制基础：纯色形状、棋盘木纹贴图、柔和投影、棋子与棋子影子、特效光晕 / 圆环 / 光束 */
import { BLACK } from '../core/types';
import { Gfx, Program, type RenderTarget, type RGBA, WHITE, Z4 } from './gl';
import { BG_FS, BOWL_FS, DUSKMIX_FS, DUSK_FS, FX_FS, SHADOW_FS, SHAPE_FS, STONE3D_FS, STONE3D_VS, STONE_FS, TEX_FS, WOOD_FS } from './shaders';
import type { Rect } from './layout';

export type Mat3 = number[]; // 列主序 3×3 旋转矩阵（物体 → 屏幕，y 轴向上）

export class Painter {
  readonly shape: Program;
  readonly tex: Program;
  readonly wood: Program;
  readonly stoneP: Program;
  readonly stone3d: Program;
  readonly bowl: Program;
  readonly shadowP: Program;
  readonly fx: Program;
  readonly bg: Program;
  readonly dusk: Program;
  readonly duskMix: Program;
  private woodRT: RenderTarget | null = null;
  private woodKey = '';

  constructor(readonly g: Gfx) {
    this.shape = new Program(g, SHAPE_FS);
    this.tex = new Program(g, TEX_FS);
    this.wood = new Program(g, WOOD_FS);
    this.stoneP = new Program(g, STONE_FS);
    this.stone3d = new Program(g, STONE3D_FS, STONE3D_VS);
    this.bowl = new Program(g, BOWL_FS);
    this.shadowP = new Program(g, SHADOW_FS);
    this.fx = new Program(g, FX_FS);
    this.bg = new Program(g, BG_FS);
    this.dusk = new Program(g, DUSK_FS);
    this.duskMix = new Program(g, DUSKMIX_FS);
  }

  // ---------------- 纯色形状 ----------------
  rect(x: number, y: number, w: number, h: number, c: RGBA) {
    this.g.use(this.shape);
    this.g.quad(x, y, w, h, c);
  }
  circle(cx: number, cy: number, r: number, c: RGBA) {
    this.g.use(this.shape);
    this.g.quad(cx - r, cy - r, 2 * r, 2 * r, c, [1, 0, 0, 0]);
  }
  roundRect(x: number, y: number, w: number, h: number, r: number, c: RGBA) {
    this.g.use(this.shape);
    this.g.quad(x, y, w, h, c, [2, r, w, h]);
  }
  roundRectLine(x: number, y: number, w: number, h: number, r: number, c: RGBA) {
    this.g.use(this.shape);
    this.g.quad(x, y, w, h, c, [3, r, w, h]);
  }
  /** 以 (cx, cy) 为中心、旋转 deg 度的实心矩形 */
  rectC(cx: number, cy: number, w: number, h: number, deg: number, c: RGBA) {
    this.g.use(this.shape);
    this.g.quadC(cx, cy, w, h, deg, c);
  }
  gradV(x: number, y: number, w: number, h: number, top: RGBA, bottom: RGBA) {
    this.g.use(this.shape);
    this.g.quadGrad(x, y, w, h, top, bottom, true);
  }
  gradH(x: number, y: number, w: number, h: number, left: RGBA, right: RGBA) {
    this.g.use(this.shape);
    this.g.quadGrad(x, y, w, h, left, right, false);
  }

  background(w: number, h: number, top: number[], bottom: number[]) {
    this.bg.set('top', top);
    this.bg.set('bottom', bottom);
    this.g.use(this.bg);
    this.g.quad(0, 0, w, h, WHITE);
  }

  /** 柔和圆角矩形投影 */
  softShadow(r: Rect, radius: number, blur: number, c: RGBA) {
    this.g.use(this.shadowP);
    const pad = blur * 2;
    this.g.quad(r.x - pad, r.y - pad, r.w + 2 * pad, r.h + 2 * pad, c, [r.w, r.h, radius, blur]);
  }

  // ---------------- 棋盘木面 ----------------
  /** 棋盘木纹：只在尺寸变化时画进离屏贴图。须在一帧开画之前调用（见 prepare） */
  prepareBoard(w: number, h: number, radius: number) {
    const g = this.g,
      dpr = g.dpr;
    const pw = Math.max(2, Math.round(w * dpr)),
      ph = Math.max(2, Math.round(h * dpr)),
      key = `${pw}x${ph}`;
    if (this.woodRT && this.woodKey === key) return;
    this.woodRT = g.createTarget(pw, ph, this.woodRT);
    this.woodKey = key;
    g.begin(this.woodRT, [0, 0, 0, 0]);
    g.setBlend('replace');
    this.wood.set('size', [pw, ph]);
    this.wood.set('radius', radius * dpr);
    this.wood.set('seed', 3.71);
    g.use(this.wood);
    g.quad(0, 0, pw, ph, WHITE);
    g.end();
  }

  get boardTex() {
    return this.woodRT?.tex ?? this.g.white;
  }

  image(tex: WebGLTexture, x: number, y: number, w: number, h: number, alpha = 1, premul = false) {
    const g = this.g;
    g.bindTexture(0, tex);
    this.tex.set('tex', 0, 'i');
    if (premul) g.setBlend('premul');
    g.use(this.tex);
    g.quad(x, y, w, h, premul ? [alpha, alpha, alpha, alpha] : [1, 1, 1, alpha]);
    if (premul) g.setBlend('alpha');
  }

  // ---------------- 棋子 ----------------
  /** 平面棋子；marker 标出最后一手 */
  stone(cx: number, cy: number, R: number, color: number, seed: number, alpha: number, marker = false) {
    this.g.use(this.stoneP);
    this.g.quad(cx - R, cy - R, 2 * R, 2 * R, [(color === BLACK ? 80 : 160) / 255, (seed & 255) / 255, marker ? 1 : 0, Math.min(alpha, 1)]);
  }
  /** 棋子的圆形影子 */
  stoneShadow(cx: number, cy: number, R: number, alpha: number) {
    const s = R * 1.5;
    this.g.use(this.stoneP);
    this.g.quad(cx - s, cy - s, 2 * s, 2 * s, [0, 0, 0, Math.min(alpha, 1)]);
  }
  /** 椭圆形的棋子影子，rx 沿 deg 方向 */
  stoneShadowE(cx: number, cy: number, rx: number, ry: number, deg: number, alpha: number) {
    this.g.use(this.stoneP);
    this.g.quadC(cx, cy, 3 * rx, 3 * ry, deg, [0, 0, 0, Math.min(alpha, 1)]);
  }
  /** 立体棋子：rot 为物体 → 屏幕的旋转矩阵（列主序，y 轴向上） */
  stone3D(cx: number, cy: number, R: number, color: number, seed: number, alpha: number, rot: Mat3) {
    this.g.use(this.stone3d);
    this.g.quad(cx - R, cy - R, 2 * R, 2 * R, [(color === BLACK ? 80 : 160) / 255, (seed & 255) / 255, 0, Math.min(alpha, 1)], quat(rot));
  }

  // ---------------- 特效 ----------------
  fxQuad(cx: number, cy: number, w: number, h: number, deg: number, mode: number, prm: number, gold: boolean, alpha: number, col: RGBA = WHITE) {
    this.g.use(this.fx);
    this.g.quadC(cx, cy, w, h, deg, [col[0], col[1], col[2], Math.max(0, Math.min(1, alpha))], [mode, Math.max(0, Math.min(1, prm)), gold ? 1 : 0, 0]);
  }
  fxGlow(cx: number, cy: number, r: number, hue: number, alpha: number) {
    this.fxQuad(cx, cy, 2 * r, 2 * r, 0, 0, hue, false, alpha);
  }
  /** 圆环：r 为外径，w 为环宽（像素）；非金色圆环用 col 着色 */
  fxRing(cx: number, cy: number, r: number, w: number, gold: boolean, alpha: number, col: RGBA = RING_RED) {
    this.fxQuad(cx, cy, 2 * r, 2 * r, 0, 1, (w / r) * 4, gold, alpha, col);
  }
  /** 光束 / 火花拖尾 */
  fxBeam(cx: number, cy: number, len: number, th: number, deg: number, hue: number, alpha: number) {
    this.fxQuad(cx, cy, len, th, deg, 2, hue, false, alpha);
  }

  blend(b: 'alpha' | 'add') {
    this.g.setBlend(b);
  }
}

export const RING_RED: RGBA = [0.78, 0.29, 0.21, 1];

/** 旋转矩阵（列主序）→ 四元数 (x, y, z, w)，取 w ≥ 0 */
function quat(r: Mat3): RGBA {
  const M = (i: number, j: number) => r[j * 3 + i];
  const tr = M(0, 0) + M(1, 1) + M(2, 2);
  let qx: number, qy: number, qz: number, qw: number;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    qw = 0.25 * s;
    qx = (M(2, 1) - M(1, 2)) / s;
    qy = (M(0, 2) - M(2, 0)) / s;
    qz = (M(1, 0) - M(0, 1)) / s;
  } else if (M(0, 0) > M(1, 1) && M(0, 0) > M(2, 2)) {
    const s = Math.sqrt(1 + M(0, 0) - M(1, 1) - M(2, 2)) * 2;
    qw = (M(2, 1) - M(1, 2)) / s;
    qx = 0.25 * s;
    qy = (M(0, 1) + M(1, 0)) / s;
    qz = (M(0, 2) + M(2, 0)) / s;
  } else if (M(1, 1) > M(2, 2)) {
    const s = Math.sqrt(1 + M(1, 1) - M(0, 0) - M(2, 2)) * 2;
    qw = (M(0, 2) - M(2, 0)) / s;
    qx = (M(0, 1) + M(1, 0)) / s;
    qy = 0.25 * s;
    qz = (M(1, 2) + M(2, 1)) / s;
  } else {
    const s = Math.sqrt(1 + M(2, 2) - M(0, 0) - M(1, 1)) * 2;
    qw = (M(1, 0) - M(0, 1)) / s;
    qx = (M(0, 2) + M(2, 0)) / s;
    qy = (M(1, 2) + M(2, 1)) / s;
    qz = 0.25 * s;
  }
  const n = Math.hypot(qx, qy, qz, qw) || 1,
    sg = qw < 0 ? -1 : 1;
  return [(qx * sg) / n, (qy * sg) / n, (qz * sg) / n, (qw * sg) / n];
}

/** 绕单位轴 (ax, ay, az) 转 a 弧度的旋转矩阵，列主序 */
export function rotAxis(ax: number, ay: number, az: number, a: number): Mat3 {
  const c = Math.cos(a),
    s = Math.sin(a),
    t = 1 - c;
  return [
    t * ax * ax + c,
    t * ax * ay + s * az,
    t * ax * az - s * ay,
    t * ax * ay - s * az,
    t * ay * ay + c,
    t * ay * az + s * ax,
    t * ax * az + s * ay,
    t * ay * az - s * ax,
    t * az * az + c,
  ];
}

export function matMul3(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9);
  for (let c = 0; c < 3; c++) for (let i = 0; i < 3; i++) r[c * 3 + i] = a[i] * b[c * 3] + a[3 + i] * b[c * 3 + 1] + a[6 + i] * b[c * 3 + 2];
  return r;
}

export { Z4 };
