/**
 * 五子棋禁手（连珠规则，只限黑棋）：
 *   长连：一手形成六子或以上
 *   四四：一手同时形成两个“四”（再下一子即成五的形）
 *   三三：一手同时形成两个“活三”（再下一子即成活四的形，且那一子本身不是禁手）
 * 黑棋这一手若恰好连成五子，则直接获胜，不论是否同时构成禁手。
 * 判断活三时要看成活四的那一点是否禁手，所以是递归的；递归深度有限，足以覆盖实战里的假三。
 */
import { BLACK, EMPTY, MAXN, type Board } from './types';

export enum Renju {
  Ok = 0,
  Overline = 1,
  DoubleFour = 2,
  DoubleThree = 3,
}

const DIRS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const;

const inB = (N: number, x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N;

/** 过 (x, y) 在方向 d 上的黑子连续长度（(x, y) 须已是黑子） */
function runLen(b: Board, N: number, x: number, y: number, d: number) {
  const [dx, dy] = DIRS[d];
  let n = 1;
  for (let k = 1; inB(N, x + k * dx, y + k * dy) && b[(x + k * dx) * MAXN + y + k * dy] === BLACK; k++) n++;
  for (let k = 1; inB(N, x - k * dx, y - k * dy) && b[(x - k * dx) * MAXN + y - k * dy] === BLACK; k++) n++;
  return n;
}

/** 在空点 q 补一颗黑子后，方向 d 上经过 p 能否恰好成五 */
function fiveThrough(b: Board, N: number, px: number, py: number, qx: number, qy: number, d: number) {
  b[qx * MAXN + qy] = BLACK;
  const ok = runLen(b, N, px, py, d) === 5;
  b[qx * MAXN + qy] = EMPTY;
  return ok;
}

/** 方向 d 上经过已落黑子 p 的“四”的个数（0、1 或 2）。活四（两头都能成五）只算一个 */
function foursInDir(b: Board, N: number, px: number, py: number, d: number) {
  const [dx, dy] = DIRS[d];
  const qs: number[] = [];
  for (let k = -4; k <= 4; k++) {
    const qx = px + k * dx,
      qy = py + k * dy;
    if (k === 0 || !inB(N, qx, qy) || b[qx * MAXN + qy] !== EMPTY) continue;
    if (fiveThrough(b, N, px, py, qx, qy, d)) qs.push(k);
  }
  if (qs.length === 2 && qs[1] - qs[0] === 5) return 1; // _XXXX_ 活四
  return qs.length >= 2 ? 2 : qs.length;
}

/** 方向 d 上经过已落黑子 p 是否有活三：存在一个空点，补上后形成经过 p 的活四，且该点不是禁手 */
function threeInDir(b: Board, N: number, px: number, py: number, d: number, depth: number) {
  const [dx, dy] = DIRS[d];
  for (let k = -4; k <= 4; k++) {
    const qx = px + k * dx,
      qy = py + k * dy;
    if (k === 0 || !inB(N, qx, qy) || b[qx * MAXN + qy] !== EMPTY) continue;
    b[qx * MAXN + qy] = BLACK;
    let open = foursInDir(b, N, px, py, d) === 1 && runLen(b, N, px, py, d) === 4;
    if (open) {
      // 活四：连续四子两端都空，且各补一子都恰好成五
      let a = 1,
        c = 1;
      while (inB(N, px + a * dx, py + a * dy) && b[(px + a * dx) * MAXN + py + a * dy] === BLACK) a++;
      while (inB(N, px - c * dx, py - c * dy) && b[(px - c * dx) * MAXN + py - c * dy] === BLACK) c++;
      const ex = px + a * dx,
        ey = py + a * dy,
        fx = px - c * dx,
        fy = py - c * dy;
      open =
        inB(N, ex, ey) &&
        inB(N, fx, fy) &&
        b[ex * MAXN + ey] === EMPTY &&
        b[fx * MAXN + fy] === EMPTY &&
        fiveThrough(b, N, px, py, ex, ey, d) &&
        fiveThrough(b, N, px, py, fx, fy, d);
    }
    b[qx * MAXN + qy] = EMPTY;
    if (open && (depth <= 0 || !forbiddenDepth(b, N, qx, qy, depth - 1))) return true;
  }
  return false;
}

function forbiddenDepth(b: Board, N: number, x: number, y: number, depth: number): Renju {
  if (b[x * MAXN + y] !== EMPTY) return Renju.Ok;
  b[x * MAXN + y] = BLACK;
  let five = false,
    over = false,
    fours = 0,
    threes = 0;
  for (let d = 0; d < 4; d++) {
    const n = runLen(b, N, x, y, d);
    if (n === 5) five = true;
    else if (n > 5) over = true;
  }
  if (!five && !over) {
    for (let d = 0; d < 4; d++) fours += foursInDir(b, N, x, y, d);
    if (fours < 2) for (let d = 0; d < 4 && threes < 2; d++) threes += threeInDir(b, N, x, y, d, depth) ? 1 : 0;
  }
  b[x * MAXN + y] = EMPTY;
  if (five) return Renju.Ok;
  if (over) return Renju.Overline;
  if (fours >= 2) return Renju.DoubleFour;
  if (threes >= 2) return Renju.DoubleThree;
  return Renju.Ok;
}

/**
 * 快速排除：三、四都要在一条线上、此点左右四格之内（中间不隔白子）另有至少两颗黑子；
 * 同一条线上的四四与长连要另有至少三颗。够不上的点不可能是禁手，免去递归检查。
 */
function mayBeForbidden(b: Board, N: number, x: number, y: number) {
  let lines2 = 0,
    lines3 = 0;
  for (let d = 0; d < 4; d++) {
    const [dx, dy] = DIRS[d];
    let n = 0;
    for (const s of [1, -1]) {
      for (let k = 1; k <= 4; k++) {
        const px = x + s * k * dx,
          py = y + s * k * dy;
        if (!inB(N, px, py)) break;
        const v = b[px * MAXN + py];
        if (v === BLACK) n++;
        else if (v !== EMPTY) break;
      }
    }
    if (n >= 2) lines2++;
    if (n >= 3) lines3++;
  }
  return lines2 >= 2 || lines3 >= 1;
}

/** 黑棋下在空点 (x, y) 是否为禁手；棋盘 b 不会被改动 */
export function renjuForbidden(b: Board, N: number, x: number, y: number): Renju {
  if (b[x * MAXN + y] !== EMPTY || !mayBeForbidden(b, N, x, y)) return Renju.Ok;
  return forbiddenDepth(b.slice(), N, x, y, 3);
}
