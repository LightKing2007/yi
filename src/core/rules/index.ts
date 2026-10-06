/**
 * 规则：纯函数，不含时间、随机数、文字。给定局面与一手棋，返回新局面（不改动传入的局面），或者不合法的原因。
 * 客户端与服务端共用；对局的其余状态（历史、点目标记、动画）由调用方管理。
 */
import type { GameConfig } from '../config';
import type { Move, Reject, Result } from '../move';
import { Renju, renjuForbidden } from '../renju';
import { BLACK, EMPTY, GameType, MAXN, WHITE, at, boardsEqual, clonePos, type Board, type Pos } from '../types';

export interface Pt {
  x: number;
  y: number;
}

/** 一手棋落下之后 */
export interface Applied {
  pos: Pos;
  /** 被提走的子（围棋） */
  captured: Pt[];
  /** 连成的五子（五子棋取胜时） */
  line: Pt[] | null;
  /** 这一手结束了对局：连五、满盘、黑棋无处可下 */
  result: Result | null;
  /** 双方连续停着，进入点目（围棋） */
  scoring: boolean;
}

export type ApplyResult = { ok: true; v: Applied } | { ok: false; why: Reject };

/** 上下左右四个相邻点的偏移 */
const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const WIN_DIRS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const;
const RENJU_REJECT: Record<number, Reject> = { [Renju.Overline]: 'renju-overline', [Renju.DoubleFour]: 'renju-44', [Renju.DoubleThree]: 'renju-33' };

const inB = (N: number, x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N;

/**
 * 在局面 pos 上走一手。prev：上一手之前的棋盘（围棋判断打劫用，没有则为 null）。
 * 对局是否已经结束、是否在点目，由调用方先判断。
 */
export function applyMove(cfg: GameConfig, pos: Pos, m: Move, prev: Board | null): ApplyResult {
  return cfg.type === GameType.Gomoku ? gomokuApply(cfg, pos, m) : goApply(cfg, pos, m, prev);
}

/** 五子棋禁手预判：黑棋在 (x, y) 是否为禁手（悬停提示、红叉用） */
export function forbiddenAt(cfg: GameConfig, pos: Pos, x: number, y: number): Reject | null {
  if (cfg.type !== GameType.Gomoku || !cfg.renju || pos.toMove !== BLACK || !inB(cfg.size, x, y) || pos.b[at(x, y)] !== EMPTY) return null;
  return RENJU_REJECT[renjuForbidden(pos.b, cfg.size, x, y)] ?? null;
}

// ---------------- 五子棋 ----------------

/** 过 (x, y) 连成的五子；禁手规则下黑棋长连不算 */
function fiveLine(b: Board, N: number, x: number, y: number, renju: boolean): Pt[] | null {
  const c = b[at(x, y)];
  for (const [dx, dy] of WIN_DIRS) {
    let a = 0,
      bb = 0;
    while (inB(N, x + (a + 1) * dx, y + (a + 1) * dy) && b[at(x + (a + 1) * dx, y + (a + 1) * dy)] === c) a++;
    while (inB(N, x - (bb + 1) * dx, y - (bb + 1) * dy) && b[at(x - (bb + 1) * dx, y - (bb + 1) * dy)] === c) bb++;
    const n = a + bb + 1;
    if (n === 5 || (n > 5 && !(renju && c === BLACK))) {
      const line: Pt[] = [];
      for (let k = -bb; k <= a; k++) line.push({ x: x + k * dx, y: y + k * dy });
      return line;
    }
  }
  return null;
}

/** 轮到的一方还有没有可下之处（开着禁手时黑棋的空点可能全是禁手） */
export function gomokuHasMove(cfg: GameConfig, pos: Pos) {
  const N = cfg.size,
    strict = cfg.renju && pos.toMove === BLACK;
  for (let x = 0; x < N; x++)
    for (let y = 0; y < N; y++) {
      if (pos.b[at(x, y)] !== EMPTY) continue;
      if (!strict || renjuForbidden(pos.b, N, x, y) === Renju.Ok) return true;
    }
  return false;
}

function gomokuApply(cfg: GameConfig, pos: Pos, m: Move): ApplyResult {
  if (m.k === 'pass') return { ok: false, why: 'pass-not-allowed' };
  const N = cfg.size,
    { x, y } = m,
    c = pos.toMove;
  if (!inB(N, x, y)) return { ok: false, why: 'off-board' };
  if (pos.b[at(x, y)] !== EMPTY) return { ok: false, why: 'occupied' };
  if (cfg.renju && c === BLACK) {
    const why = RENJU_REJECT[renjuForbidden(pos.b, N, x, y)];
    if (why) return { ok: false, why };
  }
  const next = clonePos(pos);
  next.b[at(x, y)] = c;
  next.lastX = x;
  next.lastY = y;
  next.moves++;
  next.toMove = 3 - c;
  const line = fiveLine(next.b, N, x, y, cfg.renju);
  let result: Result | null = null;
  if (line) result = { winner: c, reason: 'five' };
  else if (next.moves >= N * N || !gomokuHasMove(cfg, next)) result = { winner: 3, reason: 'full' }; // 满盘，或黑棋只剩禁手点：和棋
  return { ok: true, v: { pos: next, captured: [], line, result, scoring: false } };
}

// ---------------- 围棋 ----------------

/** 棋块的气数与所含棋子 */
export function group(b: Board, N: number, x: number, y: number) {
  const seen = new Uint8Array(MAXN * MAXN);
  const c = b[at(x, y)],
    xs = [x],
    ys = [y];
  let libs = 0;
  seen[at(x, y)] = 1;
  for (let head = 0; head < xs.length; head++) {
    const cx = xs[head] ?? 0,
      cy = ys[head] ?? 0; // xs 与 ys 等长，head 在范围内
    for (const [dx, dy] of STEPS) {
      const nx = cx + dx,
        ny = cy + dy;
      if (!inB(N, nx, ny) || seen[at(nx, ny)]) continue;
      const v = b[at(nx, ny)];
      if (v === EMPTY) {
        libs++;
        seen[at(nx, ny)] = 2;
      } else if (v === c) {
        seen[at(nx, ny)] = 1;
        xs.push(nx);
        ys.push(ny);
      }
    }
  }
  return { libs, xs, ys };
}

function goApply(cfg: GameConfig, pos: Pos, m: Move, prev: Board | null): ApplyResult {
  const N = cfg.size,
    c = pos.toMove,
    o = 3 - c;
  if (m.k === 'pass') {
    const next = clonePos(pos);
    next.passes++;
    next.moves++;
    next.lastX = next.lastY = -1;
    next.toMove = o;
    return { ok: true, v: { pos: next, captured: [], line: null, result: null, scoring: next.passes >= 2 } };
  }
  const { x, y } = m;
  if (!inB(N, x, y)) return { ok: false, why: 'off-board' };
  if (pos.b[at(x, y)] !== EMPTY) return { ok: false, why: 'occupied' };
  const next = clonePos(pos);
  next.b[at(x, y)] = c;
  const captured: Pt[] = [];
  for (const [dx, dy] of STEPS) {
    const nx = x + dx,
      ny = y + dy;
    if (!inB(N, nx, ny) || next.b[at(nx, ny)] !== o) continue;
    const g = group(next.b, N, nx, ny);
    if (g.libs === 0)
      g.xs.forEach((gx, i) => {
        const gy = g.ys[i] ?? 0; // xs 与 ys 等长
        next.b[at(gx, gy)] = EMPTY;
        captured.push({ x: gx, y: gy });
      });
  }
  if (group(next.b, N, x, y).libs === 0) return { ok: false, why: 'suicide' };
  if (prev && boardsEqual(next.b, prev)) return { ok: false, why: 'ko' };
  next.cap[c] = (next.cap[c] ?? 0) + captured.length;
  next.lastX = x;
  next.lastY = y;
  next.passes = 0;
  next.moves++;
  next.toMove = o;
  return { ok: true, v: { pos: next, captured, line: null, result: null, scoring: false } };
}

/**
 * 数子法点目：活子 + 只被一方包围的空点；白方加贴目。dead 为标记的死子（按 at(x, y) 下标，非 0 为死）。
 * terr 返回每个点的归属（1 黑 2 白 0 无）。
 */
export function score(cfg: GameConfig, pos: Pos, dead: Uint8Array) {
  const N = cfg.size,
    t = pos.b.slice(),
    terr = new Uint8Array(MAXN * MAXN);
  for (let i = 0; i < t.length; i++) if (dead[i]) t[i] = EMPTY;
  const vis = new Uint8Array(MAXN * MAXN);
  let aliveB = 0,
    aliveW = 0,
    terB = 0,
    terW = 0;
  for (let x = 0; x < N; x++)
    for (let y = 0; y < N; y++) {
      const v = t[at(x, y)];
      if (v === BLACK) aliveB++;
      else if (v === WHITE) aliveW++;
      else if (!vis[at(x, y)]) {
        const qx = [x],
          qy = [y];
        let border = 0;
        vis[at(x, y)] = 1;
        for (let h = 0; h < qx.length; h++) {
          const hx = qx[h] ?? 0,
            hy = qy[h] ?? 0; // qx 与 qy 等长，h 在范围内
          for (const [dx, dy] of STEPS) {
            const nx = hx + dx,
              ny = hy + dy;
            if (!inB(N, nx, ny)) continue;
            const w = t[at(nx, ny)];
            if (w === EMPTY) {
              if (!vis[at(nx, ny)]) {
                vis[at(nx, ny)] = 1;
                qx.push(nx);
                qy.push(ny);
              }
            } else border |= w ?? 0;
          }
        }
        const owner = border === BLACK ? BLACK : border === WHITE ? WHITE : 0;
        qx.forEach((px, i) => (terr[at(px, qy[i] ?? 0)] = owner));
        if (owner === BLACK) terB += qx.length;
        else if (owner === WHITE) terW += qx.length;
      }
    }
  return { b: aliveB + terB, w: aliveW + terW + cfg.komi, terr };
}
