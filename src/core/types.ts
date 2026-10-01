/** 棋盘与棋局的基本类型。棋盘统一按 19 路的步长存成一维数组：下标 = x * MAXN + y */
export const MAXN = 19;
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;
export type Color = typeof BLACK | typeof WHITE;

export enum GameType { Gomoku = 0, Go = 1 }

export type Board = Uint8Array;

export const at = (x: number, y: number) => x * MAXN + y;
export const newBoard = (): Board => new Uint8Array(MAXN * MAXN);
export const other = (c: number) => 3 - c;

/** 局面：棋盘与轮到谁、提子数、上一手、连续停着次数、手数 */
export interface Pos {
  b: Board;
  toMove: number;
  cap: [number, number, number];   // cap[BLACK] = 黑方提走的白子数
  lastX: number;
  lastY: number;
  passes: number;
  moves: number;
}

export function newPos(): Pos {
  return { b: newBoard(), toMove: BLACK, cap: [0, 0, 0], lastX: -1, lastY: -1, passes: 0, moves: 0 };
}

export function clonePos(p: Pos): Pos {
  return { b: p.b.slice(), toMove: p.toMove, cap: [p.cap[0], p.cap[1], p.cap[2]], lastX: p.lastX, lastY: p.lastY, passes: p.passes, moves: p.moves };
}

export const boardsEqual = (a: Board, b: Board) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** 可复现的随机数（xorshift32），AI 与特效用 */
export class Rng {
  private s: number;
  constructor(seed = 0x9e3779b9) { this.s = seed >>> 0 || 0x9e3779b9; }
  seed(v: number) { this.s = (v >>> 0) || 0x9e3779b9; }
  u32() { let s = this.s; s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; this.s = s >>> 0; return this.s; }
  /** [0, 1) */
  next() { return this.u32() / 4294967296; }
  /** [a, b] 内的整数 */
  int(a: number, b: number) { return a + (this.u32() % (b - a + 1)); }
  range(a: number, b: number) { return a + (b - a) * this.next(); }
}

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const smooth01 = (x: number) => { x = clamp01(x); return x * x * (3 - 2 * x); };
export const easeOut = (t: number) => { t = clamp01(t); return 1 - (1 - t) ** 3; };
