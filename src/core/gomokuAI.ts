/**
 * 五子棋人机，三档难度：
 *   简单：一步评分后在前几名里按权重随机挑，偶尔漏看对方的冲四
 *   普通：一步评分取最高，进攻与防守兼顾
 *   困难：在评分最高的若干候选点上做 alpha-beta 搜索，逐层加深到双方合计六层，限时 1.2 秒（来不及就用已算完的最深一层），
 *         局面按双方所有五元组的得分差评估，能提前看出四三、双活三等杀棋，也会提前防守
 * 三档都会先抓住自己的连五，普通与困难必定挡住对方的连五。
 * 热点循环都用一维下标与预先分配的数组，不在搜索中途分配对象。
 */
import { now } from './clock';
import { renjuForbidden } from './renju';
import { BLACK, EMPTY, MAXN, type Board } from './types';

export interface GomokuSnap {
  b: Board;
  N: number;
  me: number;
  renju: boolean;
}

const DX = [1, 0, 1, 1],
  DY = [0, 1, 1, -1];
const STEP = [MAXN, 1, MAXN + 1, MAXN - 1]; // 四个方向在一维下标里的步长
const WIN_SCORE = 1e9;
const HARD_DEPTH = 6;
const HARD_BUDGET_MS = 1200; // 困难一步最多想多久：慢电脑上也不会一步想好几秒
const MS_PER_SEC = 1000;
const ABORT = { abort: true }; // 超时时从搜索里抛出来

const MY = [7, 35, 800, 15000, 800000];
const OP = [7, 15, 400, 1800, 100000];
const MINE = [0, 12, 160, 2600, 5000000, 10000000];
const THEIRS = [0, 10, 110, 1400, 60000, 10000000];

/** 每层搜索各用一组候选点缓冲 */
class Cands {
  x = new Int32Array(16);
  y = new Int32Array(16);
  s = new Float64Array(16);
  n = 0;
}

class Searcher {
  private levels: Cands[] = [];
  /** 超过这个时刻（clock.ts 的 now()，秒）就放弃当前这一层搜索；Infinity 表示不限时 */
  deadline = Infinity;
  private nodes = 0;
  constructor(
    readonly b: Board,
    readonly N: number,
    readonly renju: boolean,
  ) {
    for (let i = 0; i <= HARD_DEPTH + 2; i++) this.levels.push(new Cands());
  }

  /** 在 (x, y) 落 c 之后是否连成五子（禁手规则下黑棋须恰好五子） */
  makesFive(x: number, y: number, c: number) {
    const b = this.b,
      N = this.N;
    for (let d = 0; d < 4; d++) {
      const dx = DX[d],
        dy = DY[d];
      let n = 1,
        px = x + dx,
        py = y + dy;
      while (px >= 0 && py >= 0 && px < N && py < N && b[px * MAXN + py] === c) {
        n++;
        px += dx;
        py += dy;
      }
      px = x - dx;
      py = y - dy;
      while (px >= 0 && py >= 0 && px < N && py < N && b[px * MAXN + py] === c) {
        n++;
        px -= dx;
        py -= dy;
      }
      if (n === 5 || (n > 5 && !(this.renju && c === BLACK))) return true;
    }
    return false;
  }

  /** 在空点 (x, y) 落 me 的一步评分：经过此点的全部五元组得分之和 */
  pointScore(x: number, y: number, me: number) {
    const b = this.b,
      N = this.N,
      op = 3 - me;
    let s = 0;
    for (let d = 0; d < 4; d++) {
      const dx = DX[d],
        dy = DY[d],
        st = STEP[d];
      for (let k = -4; k <= 0; k++) {
        const sx = x + k * dx,
          sy = y + k * dy,
          ex = sx + 4 * dx,
          ey = sy + 4 * dy;
        if (sx < 0 || sy < 0 || sx >= N || sy >= N || ex < 0 || ey < 0 || ex >= N || ey >= N) continue;
        let m = 0,
          t = 0,
          i = sx * MAXN + sy;
        for (let j = 0; j < 5; j++, i += st) {
          const v = b[i];
          if (v === me) m++;
          else if (v === op) t++;
        }
        s += m && t ? 0 : m ? MY[m] : t ? OP[t] : MY[0];
      }
    }
    const cd = Math.abs(x - (N - 1) / 2) + Math.abs(y - (N - 1) / 2); // 同分时略偏向中央
    return s * 16 + Math.trunc(20 - cd);
  }

  /** 候选点：离已有棋子两格以内的空点，按一步评分从高到低取前 max 个，写进第 level 层的缓冲 */
  candidates(me: number, max: number, level: number): Cands {
    const b = this.b,
      N = this.N,
      c = this.levels[level];
    c.n = 0;
    for (let x = 0; x < N; x++)
      for (let y = 0; y < N; y++) {
        if (b[x * MAXN + y] !== EMPTY) continue;
        let near = false;
        const x0 = Math.max(0, x - 2),
          x1 = Math.min(N - 1, x + 2),
          y0 = Math.max(0, y - 2),
          y1 = Math.min(N - 1, y + 2);
        for (let i = x0; i <= x1 && !near; i++)
          for (let j = y0; j <= y1; j++)
            if (b[i * MAXN + j] !== EMPTY) {
              near = true;
              break;
            }
        if (!near) continue;
        const s = this.pointScore(x, y, me);
        if (c.n === max && s <= c.s[max - 1]) continue;
        if (this.renju && me === BLACK && !this.makesFive(x, y, me) && renjuForbidden(b, N, x, y)) continue; // 黑棋不下禁手
        let k = c.n < max ? c.n++ : max - 1;
        while (k > 0 && c.s[k - 1] < s) {
          c.x[k] = c.x[k - 1];
          c.y[k] = c.y[k - 1];
          c.s[k] = c.s[k - 1];
          k--;
        }
        c.x[k] = x;
        c.y[k] = y;
        c.s[k] = s;
      }
    return c;
  }

  /** 局面评估（站在轮到走的 me 一方）：轮到我走，所以我方的四几乎等于赢，对方的四还能挡 */
  evaluate(me: number) {
    const b = this.b,
      N = this.N,
      op = 3 - me;
    let s = 0;
    for (let d = 0; d < 4; d++) {
      const dx = DX[d],
        dy = DY[d],
        st = STEP[d];
      const xa = 0,
        xb = N - 1 - 4 * dx,
        ya = dy < 0 ? 4 : 0,
        yb = dy > 0 ? N - 5 : N - 1;
      for (let x = xa; x <= xb; x++)
        for (let y = ya; y <= yb; y++) {
          let m = 0,
            t = 0,
            i = x * MAXN + y;
          for (let j = 0; j < 5; j++, i += st) {
            const v = b[i];
            if (v === me) m++;
            else if (v === op) t++;
          }
          if (!t) s += MINE[m];
          else if (!m) s -= THEIRS[t];
        }
    }
    return s;
  }

  negamax(me: number, depth: number, alpha: number, beta: number): number {
    if ((++this.nodes & 1023) === 0 && now() > this.deadline) throw ABORT;
    if (depth === 0) return this.evaluate(me);
    const c = this.candidates(me, 10, depth);
    const n = c.n;
    if (!n) return this.evaluate(me);
    for (let i = 0; i < n; i++) if (this.makesFive(c.x[i], c.y[i], me)) return WIN_SCORE + depth;
    let best = -WIN_SCORE * 2;
    for (let i = 0; i < n; i++) {
      const p = c.x[i] * MAXN + c.y[i];
      this.b[p] = me;
      const v = -this.negamax(3 - me, depth - 1, -beta, -alpha);
      this.b[p] = EMPTY;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  findFive(c: number) {
    for (let x = 0; x < this.N; x++) for (let y = 0; y < this.N; y++) if (this.b[x * MAXN + y] === EMPTY && this.makesFive(x, y, c)) return { x, y };
    return null;
  }
}

/** 为轮到的一方选一手。level：0 简单，1 普通，2 困难。棋盘已满时返回 null */
export function gomokuMove(snap: GomokuSnap, level: number, random: () => number = Math.random, budgetMs = HARD_BUDGET_MS): { x: number; y: number } | null {
  const { N, me } = snap,
    op = 3 - me;
  const s = new Searcher(snap.b.slice(), N, snap.renju);
  const top = s.candidates(me, 16, HARD_DEPTH + 1);
  const n = top.n;
  const cand = (i: number) => ({ x: top.x[i], y: top.y[i] });
  if (!n) {
    // 空棋盘：下天元
    const c = N >> 1;
    return s.b[c * MAXN + c] === EMPTY ? { x: c, y: c } : null;
  }
  const mine = s.findFive(me);
  if (mine) return mine;
  if (level > 0 || random() < 0.6) {
    const theirs = s.findFive(op);
    if (theirs) return theirs;
  }

  if (level === 0) {
    // 前四名按 4:3:2:1 加权随机
    const k = Math.min(n, 4),
      total = (k * (k + 1)) / 2;
    let r = Math.floor(random() * total);
    for (let i = 0; i < k; i++) {
      r -= k - i;
      if (r < 0) return cand(i);
    }
    return cand(0);
  }
  if (level === 1) {
    // 评分最高者，同分附近加一点随机
    let pick = 0,
      best = -1;
    for (let i = 0; i < n; i++) {
      const v = top.s[i] + Math.floor(random() * 7);
      if (v > best) {
        best = v;
        pick = i;
      }
    }
    return cand(pick);
  }
  // 困难：对前 12 个候选点逐层加深搜索（2、4、6 层），上一层最好的点放到最前面先算；超时就用已经算完的最深一层
  const m = Math.min(n, 12),
    xs = top.x.slice(0, m),
    ys = top.y.slice(0, m),
    order = Array.from({ length: m }, (_, i) => i);
  let pick = 0;
  s.deadline = now() + budgetMs / MS_PER_SEC; // 时间经 clock.ts 读取，测试可换成手动推进的时钟（ARC-020、TST-020）
  for (const depth of [2, 4, HARD_DEPTH]) {
    let bestI = order[0],
      best = -WIN_SCORE * 4,
      alpha = -WIN_SCORE * 4;
    try {
      for (const i of order) {
        const p = xs[i] * MAXN + ys[i];
        s.b[p] = me;
        const v = -s.negamax(op, depth - 1, -WIN_SCORE * 4, -alpha);
        s.b[p] = EMPTY;
        if (v > best) {
          best = v;
          bestI = i;
        }
        if (v > alpha) alpha = v;
      }
    } catch (e) {
      if (e !== ABORT) throw e;
      break; // 这一层没算完：不用它的结果（棋盘副本也不再用）
    }
    pick = bestI;
    order.splice(order.indexOf(bestI), 1);
    order.unshift(bestI);
  }
  return { x: xs[pick], y: ys[pick] };
}
