/**
 * 围棋人机。
 *   简单：一步启发——能提就提，被叫吃就逃，不填自己的眼、不自己送吃，其余在棋子附近挑一手
 *   普通、困难：蒙特卡洛树搜索（UCT + RAVE）。从当前局面出发反复下完随机对局，
 *         统计每一手的胜率，最后选试得最多的那一手；困难思考更久，随机对局里也会优先提子、逃子
 * 终局点目时，用同样的随机对局估计每块棋最终归谁，自动标出死子（markDead）。
 */
import { BLACK, EMPTY, MAXN, Rng, WHITE, type Board } from './types';

const GV = (MAXN + 2) * (MAXN + 2);
const PASS = -1;
const BORDER = 3;

/** 快速棋盘：带边框的一维数组，棋块用环形链表串起，记伪气数 */
class GB {
  N = 0;
  W = 0;
  c = new Uint8Array(GV);
  head = new Int16Array(GV);
  nxt = new Int16Array(GV);
  libs = new Int16Array(GV);
  size = new Int16Array(GV);
  empty = new Int16Array(GV);
  epos = new Int16Array(GV);
  ne = 0;
  ko = -1;
  toMove = BLACK;
  passes = 0;
  moves = 0;
  last = PASS;
  komi = 7.5;
  d: [number, number, number, number] = [1, -1, 0, 0];

  // 下列取值方法供按下标读取时使用：下标都由棋盘内的点与方向算出，不会超出数组；取不到时的返回值只为满足类型检查
  /** 点 p 的颜色；超出数组时视为界外 */
  col(p: number) {
    return this.c[p] ?? BORDER;
  }
  /** 点 p 所在棋块的块首 */
  hd(p: number) {
    return this.head[p] ?? 0;
  }
  /** 环形链表中 p 的下一个子；取不到时返回 p 本身，使遍历终止 */
  next(p: number) {
    return this.nxt[p] ?? p;
  }
  /** 棋块 block 的伪气数 */
  lib(block: number) {
    return this.libs[block] ?? 0;
  }
  /** 棋块 block 的伪气数加 n */
  addLib(block: number, n: number) {
    this.libs[block] = this.lib(block) + n;
  }
  /** 棋块 block 的子数 */
  sz(block: number) {
    return this.size[block] ?? 0;
  }
  /** 第 k 个方向（0 至 3）的下标增量 */
  dir(k: number) {
    return this.d[k] ?? 0;
  }

  copyFrom(o: GB) {
    this.N = o.N;
    this.W = o.W;
    this.c.set(o.c);
    this.head.set(o.head);
    this.nxt.set(o.nxt);
    this.libs.set(o.libs);
    this.size.set(o.size);
    this.empty.set(o.empty);
    this.epos.set(o.epos);
    this.ne = o.ne;
    this.ko = o.ko;
    this.toMove = o.toMove;
    this.passes = o.passes;
    this.moves = o.moves;
    this.last = o.last;
    this.komi = o.komi;
    this.d = o.d;
    return this;
  }

  idx(x: number, y: number) {
    return (y + 1) * this.W + (x + 1);
  }
  emptyAdd(p: number) {
    this.epos[p] = this.ne;
    this.empty[this.ne++] = p;
  }
  emptyDel(p: number) {
    const i = this.epos[p] ?? 0,
      q = this.empty[--this.ne] ?? 0;
    this.empty[i] = q;
    this.epos[q] = i;
  }

  setup(b: Board, N: number, toMove: number, passes: number, komi: number) {
    this.N = N;
    this.W = N + 2;
    this.komi = komi;
    this.d = [1, -1, this.W, -this.W];
    this.ko = -1;
    this.last = PASS;
    this.ne = 0;
    this.moves = 0;
    this.c.fill(BORDER);
    this.head.fill(0);
    this.nxt.fill(0);
    this.libs.fill(0);
    this.size.fill(0);
    for (let x = 0; x < N; x++)
      for (let y = 0; y < N; y++) {
        const p = this.idx(x, y);
        this.c[p] = b[x * MAXN + y] ?? EMPTY;
        if (!this.c[p]) this.emptyAdd(p);
      }
    const queue = new Int16Array(GV);
    for (let x = 0; x < N; x++)
      for (let y = 0; y < N; y++) {
        // 洪水填充建棋块
        const p = this.idx(x, y);
        if (this.c[p] === EMPTY || this.c[p] === BORDER || this.size[p] || this.head[p]) continue;
        let n = 0;
        const col = this.c[p];
        queue[n++] = p;
        this.head[p] = p;
        this.nxt[p] = p;
        for (let i = 0; i < n; i++)
          for (let k = 0; k < 4; k++) {
            const dk = this.dir(k);
            const q = (queue[i] ?? 0) + dk;
            if (this.col(q) === col && !this.head[q]) {
              this.head[q] = p;
              this.nxt[q] = this.next(p);
              this.nxt[p] = q;
              queue[n++] = q;
            }
          }
        this.size[p] = n;
      }
    for (let x = 0; x < N; x++)
      for (let y = 0; y < N; y++) {
        // 伪气：每个棋子每个相邻空点记一次
        const p = this.idx(x, y);
        if (this.c[p] !== BLACK && this.c[p] !== WHITE) continue;
        for (let k = 0; k < 4; k++) if (this.col(p + this.dir(k)) === EMPTY) this.addLib(this.hd(p), 1);
      }
    this.toMove = toMove;
    this.passes = passes;
  }

  /** 棋块 h 除 p 之外是否还有别的气 */
  hasOtherLib(h: number, p: number) {
    let s = h;
    do {
      for (let k = 0; k < 4; k++) {
        const dk = this.dir(k);
        const q = s + dk;
        if (this.col(q) === EMPTY && q !== p) return true;
      }
      s = this.next(s);
    } while (s !== h);
    return false;
  }

  /** 棋块 h 的真实气数，数到 max 为止；lib[0] 输出其中一口气 */
  countLibs(h: number, max: number, lib?: number[]) {
    stampCur++;
    if (stampCur > 65000) {
      stamp.fill(0);
      stampCur = 1;
    }
    let n = 0,
      s = h;
    do {
      for (let k = 0; k < 4; k++) {
        const dk = this.dir(k);
        const q = s + dk;
        if (this.col(q) === EMPTY && stamp[q] !== stampCur) {
          stamp[q] = stampCur;
          if (lib) lib[0] = q;
          if (++n >= max) return n;
        }
      }
      s = this.next(s);
    } while (s !== h);
    return n;
  }

  legal(p: number, me: number) {
    if (this.c[p] !== EMPTY || p === this.ko) return false;
    for (let k = 0; k < 4; k++) {
      const dk = this.dir(k);
      const q = p + dk,
        c = this.col(q);
      if (c === EMPTY) return true;
      if (c === BORDER) continue;
      const otherLib = this.hasOtherLib(this.hd(q), p);
      if (c === me && otherLib) return true; // 连上一块还有气的棋
      if (c !== me && !otherLib) return true; // 提掉对方
    }
    return false;
  }

  /** p 是否为 me 的眼：四邻都是己方或界外，斜角对方子不多 */
  isEye(p: number, me: number) {
    const W = this.W;
    let edge = false,
      bad = 0;
    for (let k = 0; k < 4; k++) {
      const dk = this.dir(k);
      const c = this.col(p + dk);
      if (c === BORDER) edge = true;
      else if (c !== me) return false;
    }
    const dg = [W + 1, W - 1, -W + 1, -W - 1];
    for (const g of dg) if (this.col(p + g) === 3 - me) bad++;
    return edge ? bad === 0 : bad < 2;
  }

  private merge(a: number, c: number) {
    if (this.sz(a) < this.sz(c)) {
      const t = a;
      a = c;
      c = t;
    }
    let s = c;
    do {
      this.head[s] = a;
      s = this.next(s);
    } while (s !== c);
    const t = this.next(a);
    this.nxt[a] = this.next(c);
    this.nxt[c] = t;
    this.size[a] = this.sz(a) + this.sz(c);
    this.libs[a] = this.lib(a) + this.lib(c);
  }

  private remove(h: number, one: number[]) {
    let n = 0,
      s = h;
    do {
      this.c[s] = EMPTY;
      this.emptyAdd(s);
      one[0] = s;
      n++;
      s = this.next(s);
    } while (s !== h);
    s = h;
    do {
      const nx = this.next(s);
      for (let k = 0; k < 4; k++) {
        const dk = this.dir(k);
        const cq = this.col(s + dk);
        if (cq === BLACK || cq === WHITE) this.addLib(this.hd(s + dk), 1);
      }
      this.head[s] = 0;
      s = nx;
    } while (s !== h);
    return n;
  }

  /** 当前一方在 p 落子（或停一手）；调用前须确认合法 */
  play(p: number) {
    const me = this.toMove,
      op = 3 - me;
    this.toMove = op;
    this.moves++;
    this.last = p;
    if (p === PASS) {
      this.passes++;
      this.ko = -1;
      return;
    }
    this.passes = 0;
    this.c[p] = me;
    this.emptyDel(p);
    this.head[p] = p;
    this.nxt[p] = p;
    this.size[p] = 1;
    this.libs[p] = 0;
    this.settle(p, me);
    this.capture(p, op);
  }

  /** 新落在 p 的 me 子：记它的气、扣相邻棋块的气，并与相连的己方棋块合并 */
  private settle(p: number, me: number) {
    for (let k = 0; k < 4; k++) {
      const q = p + this.dir(k),
        cq = this.col(q);
      if (cq === EMPTY) this.addLib(p, 1);
      else if (cq === BLACK || cq === WHITE) this.addLib(this.hd(q), -1);
    }
    for (let k = 0; k < 4; k++) {
      const q = p + this.dir(k);
      if (this.col(q) === me && this.hd(q) !== this.hd(p)) this.merge(this.hd(p), this.hd(q));
    }
  }

  /** 提掉 p 四周没有气的 op 棋块，并按提子数判断劫 */
  private capture(p: number, op: number) {
    let captured = 0;
    const one = [-1];
    for (let k = 0; k < 4; k++) {
      const q = p + this.dir(k);
      if (this.col(q) === op && this.lib(this.hd(q)) === 0) captured += this.remove(this.hd(q), one);
    }
    const h = this.hd(p);
    this.ko = captured === 1 && this.sz(h) === 1 && this.countLibs(h, 2) === 1 ? (one[0] ?? -1) : -1;
  }

  /** 数子法判胜负 */
  winner() {
    let s = -this.komi;
    for (let x = 0; x < this.N; x++)
      for (let y = 0; y < this.N; y++) {
        const p = this.idx(x, y),
          c = this.c[p];
        if (c === BLACK) s++;
        else if (c === WHITE) s--;
        else {
          let seen = 0;
          for (let k = 0; k < 4; k++) {
            const dk = this.dir(k);
            const q = this.col(p + dk);
            if (q === BLACK || q === WHITE) seen |= q;
          }
          if (seen === BLACK) s++;
          else if (seen === WHITE) s--;
        }
      }
    return s > 0 ? BLACK : WHITE;
  }
}

const stamp = new Uint16Array(GV);
let stampCur = 0;

/** 随机对局的一手：heavy 时先看上一手附近——能提就提，被叫吃就逃；否则随机选一个不填自己眼的合法点 */
function playoutMove(b: GB, heavy: boolean, rng: Rng) {
  const me = b.toMove;
  if (heavy && b.last !== PASS && rng.u32() & 7) {
    const lib = [0];
    for (let k = -1; k < 4; k++) {
      const q = k < 0 ? b.last : b.last + b.dir(k),
        c = b.col(q);
      if (c !== BLACK && c !== WHITE) continue;
      if (b.countLibs(b.hd(q), 2, lib) !== 1) continue;
      const only = lib[0] ?? 0;
      if (!b.legal(only, me)) continue;
      if (c !== me) return only; // 提子
      let free = 0; // 逃子：逃完至少两口气
      for (let k = 0; k < 4; k++) if (b.col(only + b.dir(k)) === EMPTY) free++;
      if (free >= 2) return only;
    }
  }
  const n = b.ne;
  if (!n) return PASS;
  const start = rng.u32() % n;
  for (let i = 0; i < n; i++) {
    const p = b.empty[(start + i) % n] ?? 0;
    if (b.legal(p, me) && !b.isEye(p, me)) return p;
  }
  return PASS;
}

/** 下完一局随机对局，返回胜者；amaf 记录每个点第一次由谁落子 */
function playout(b: GB, heavy: boolean, rng: Rng, amaf?: Uint8Array) {
  const limit = b.N * b.N * 3;
  while (b.passes < 2 && b.moves < limit) {
    const p = playoutMove(b, heavy, rng);
    if (p !== PASS && amaf && !amaf[p]) amaf[p] = b.toMove;
    b.play(p);
  }
  return b.winner();
}

export interface GoSnap {
  b: Board;
  N: number;
  toMove: number;
  passes: number;
  moves: number;
  lastX: number;
  lastY: number;
  komi: number;
  /** 上一手之前的局面（判断“不能回到上一手之前的局面”的劫），没有则为 null */
  prev: Board | null;
}

export interface GoThinkOptions {
  /** 思考时间倍率（默认 1） */
  timeScale?: number;
  /** 大于 0 时不按时间、而按固定的模拟次数思考 */
  iterations?: number;
  seed?: number;
  cancelled?: () => boolean;
}

// ---------------- 搜索树（结构数组） ----------------
const NODE_POOL = 300000;
const RAVE_K = 800;
const UCT_C = 0.28;
const nMove = new Int16Array(NODE_POOL),
  nChildCount = new Uint16Array(NODE_POOL),
  nChild = new Int32Array(NODE_POOL);
const nN = new Int32Array(NODE_POOL),
  nRN = new Int32Array(NODE_POOL),
  nW = new Float32Array(NODE_POOL),
  nRW = new Float32Array(NODE_POOL);
let nodeCount = 0;

// 下列取值函数供按结点下标读取：下标都是已分配的结点，取不到时的返回值只为满足类型检查
const moveOf = (c: number) => nMove[c] ?? PASS;
const firstChild = (c: number) => nChild[c] ?? -1;
const childCount = (c: number) => nChildCount[c] ?? 0;
const visitsOf = (c: number) => nN[c] ?? 0;
const raveVisitsOf = (c: number) => nRN[c] ?? 0;
const winsOf = (c: number) => nW[c] ?? 0;
const raveWinsOf = (c: number) => nRW[c] ?? 0;

function newNode(i: number, move: number) {
  nMove[i] = move;
  nChildCount[i] = 0;
  nChild[i] = -1;
  nN[i] = 0;
  nRN[i] = 0;
  nW[i] = 0;
  nRW[i] = 0;
}

/** 子结点 c 的选择值：胜率与 RAVE 胜率按访问次数加权，加上 UCT 的探索项；lg 为父结点访问次数加 1 的对数 */
function uct(c: number, lg: number, passes: number) {
  const n = visitsOf(c),
    rn = raveVisitsOf(c);
  const q = n ? winsOf(c) / n : 0.5,
    aq = rn ? raveWinsOf(c) / rn : 0.5;
  const beta = rn ? rn / (rn + n + (rn * n) / RAVE_K) : 0;
  let v = n || rn ? (1 - beta) * q + beta * aq : 1.1;
  if (nMove[c] === PASS && passes === 0) v -= 0.25; // 没人停着时先别急着停
  return v + UCT_C * Math.sqrt(lg / (n + 1));
}

class Search {
  root = new GB();
  tmp = new GB();
  work = new GB();
  amaf = new Uint8Array(GV);
  rng: Rng;
  prev: Board | null;
  constructor(
    snap: GoSnap,
    readonly level: number,
    seed: number,
  ) {
    this.root.setup(snap.b, snap.N, snap.toMove, snap.passes, snap.komi);
    this.root.moves = snap.moves;
    if (snap.lastX >= 0) this.root.last = this.root.idx(snap.lastX, snap.lastY);
    this.prev = snap.prev;
    this.rng = new Rng(seed);
    nodeCount = 1;
    newNode(0, PASS);
  }

  /** 严格按对局规则（含“不能回到上一手之前的局面”的劫）判断 p 是否可下 */
  realLegal(b: GB, p: number) {
    if (!b.legal(p, b.toMove)) return false;
    if (!this.prev) return true;
    const t = this.tmp.copyFrom(b);
    t.play(p);
    for (let x = 0; x < t.N; x++) for (let y = 0; y < t.N; y++) if (t.c[t.idx(x, y)] !== this.prev[x * MAXN + y]) return true;
    return false;
  }

  easyMove() {
    const root = this.root,
      me = root.toMove,
      t = new GB();
    let best = PASS,
      bestS = -500;
    const early = root.moves < (root.N * root.N) / 4;
    for (let i = 0; i < root.ne; i++) {
      const p = root.empty[i] ?? 0;
      if (!this.realLegal(root, p) || root.isEye(p, me)) continue;
      t.copyFrom(root);
      const before = t.ne;
      t.play(p);
      const caught = t.ne - before + 1; // 提掉的子数
      const libs = t.countLibs(t.hd(p), 3);
      let s = this.rng.u32() % 20;
      s += caught * 400;
      if (!caught && libs === 1)
        s -= 900; // 自己送吃
      else if (libs === 2 && !caught) s -= 60;
      for (let k = 0; k < 4; k++) {
        const dk = root.dir(k);
        // 救出被叫吃的己方棋块
        const q = p + dk;
        if (root.col(q) === me && root.countLibs(root.hd(q), 2) === 1 && libs >= 2) s += 500 + 40 * root.sz(root.hd(q));
      }
      const x = (p % root.W) - 1,
        y = Math.floor(p / root.W) - 1;
      const line = 1 + Math.min(x, y, root.N - 1 - x, root.N - 1 - y);
      if (early && line === 1) s -= 60;
      if (line === 3 || line === 4) s += 12;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++)
        for (let dx = -2; dx <= 2 && !near; dx++) {
          const q = p + dy * root.W + dx;
          near = q >= 0 && q < GV && (root.c[q] === BLACK || root.c[q] === WHITE);
        }
      if (near) s += 25;
      if (s > bestS) {
        bestS = s;
        best = p;
      }
    }
    return best;
  }

  expand(node: number, b: GB, atRoot: boolean) {
    const me = b.toMove,
      first = nodeCount;
    if (nodeCount + b.ne + 1 >= NODE_POOL) return 0;
    let n = 0;
    for (let i = 0; i < b.ne; i++) {
      const p = b.empty[i] ?? 0;
      if (b.isEye(p, me) || !(atRoot ? this.realLegal(b, p) : b.legal(p, me))) continue;
      newNode(first + n++, p);
    }
    newNode(first + n++, PASS);
    nodeCount += n;
    nChild[node] = first;
    nChildCount[node] = n;
    return n;
  }

  select(node: number, passes: number) {
    const lg = Math.log(visitsOf(node) + 1),
      c0 = firstChild(node),
      count = childCount(node);
    let best = -1e9,
      pick = c0;
    for (let i = 0; i < count; i++) {
      const value = uct(c0 + i, lg, passes);
      if (value > best) {
        best = value;
        pick = c0 + i;
      }
    }
    return pick;
  }

  private path = new Int32Array(1024);
  private mover = new Int32Array(1024);

  iterate() {
    const b = this.work.copyFrom(this.root),
      amaf = this.amaf,
      path = this.path,
      mover = this.mover;
    amaf.fill(0);
    let np = 0,
      node = 0;
    path[np] = 0;
    mover[np] = b.toMove;
    np++;
    while (firstChild(node) >= 0 && b.passes < 2 && np < 1000) {
      const ch = this.select(node, b.passes),
        m = moveOf(ch);
      if (m !== PASS && !amaf[m]) amaf[m] = b.toMove;
      b.play(m);
      node = ch;
      path[np] = ch;
      mover[np] = b.toMove;
      np++;
    }
    const threshold = b.N >= 13 ? 3 : 1;
    if (b.passes < 2 && firstChild(node) < 0 && visitsOf(node) >= threshold && this.expand(node, b, false)) {
      const ch = this.select(node, b.passes),
        m = moveOf(ch);
      if (m !== PASS && !amaf[m]) amaf[m] = b.toMove;
      b.play(m);
      path[np] = ch;
      mover[np] = b.toMove;
      np++;
    }
    const winner = b.passes >= 2 ? b.winner() : playout(b, this.level >= 2, this.rng, amaf);
    // 回传：结点 i 的这一手由 mover[i-1] 落下
    nN[0] = visitsOf(0) + 1;
    for (let i = 1; i < np; i++) {
      const c = path[i] ?? 0;
      nN[c] = visitsOf(c) + 1;
      if (winner === mover[i - 1]) nW[c] = winsOf(c) + 1;
    }
    // RAVE：路径上每个结点的孩子里，凡是之后由同一方先下到的点都算一次
    for (let i = 0; i < np; i++) {
      const P = path[i] ?? 0,
        c0 = firstChild(P);
      if (c0 < 0) continue;
      const who = mover[i],
        count = childCount(P);
      for (let k = 0; k < count; k++) {
        const c = c0 + k,
          m = moveOf(c);
        if (m !== PASS && amaf[m] === who) {
          nRN[c] = raveVisitsOf(c) + 1;
          if (winner === who) nRW[c] = raveWinsOf(c) + 1;
        }
      }
    }
  }

  toXY(p: number) {
    return p === PASS ? { x: -1, y: -1 } : { x: (p % this.root.W) - 1, y: Math.floor(p / this.root.W) - 1 };
  }
}

/** 为轮到的一方思考，返回落点；(-1, -1) 表示停一手 */
export function goThink(snap: GoSnap, level: number, opt: GoThinkOptions = {}): { x: number; y: number } {
  const s = new Search(snap, level, opt.seed ?? (Math.random() * 4294967295) >>> 0);
  if (level === 0) return s.toXY(s.easyMove());
  s.expand(0, s.root, true);
  if (opt.iterations && opt.iterations > 0) {
    for (let i = 0; i < opt.iterations; i++) s.iterate();
  } else {
    const budget = (level >= 2 ? 3.0 : 1.2) * (opt.timeScale ?? 1) * 1000,
      t0 = performance.now();
    while (childCount(0) > 1 && performance.now() - t0 < budget && !(opt.cancelled && opt.cancelled())) {
      for (let i = 0; i < 16; i++) s.iterate();
    }
  }
  let most = -1,
    p = PASS;
  const count = childCount(0),
    c0 = firstChild(0);
  for (let i = 0; i < count; i++) {
    const c = c0 + i,
      n = visitsOf(c);
    if (n > most) {
      most = n;
      p = moveOf(c);
    }
  }
  return s.toXY(p);
}

/** 点目时用随机对局估计每块棋的归属：返回多半会被吃掉的棋子（逐个坐标） */
export function estimateDead(b: Board, N: number, komi: number): { x: number; y: number }[] {
  const root = new GB(),
    work = new GB(),
    rng = new Rng((Math.random() * 4294967295) >>> 0);
  const runs = N >= 19 ? 160 : N >= 13 ? 240 : 400;
  root.setup(b, N, BLACK, 0, komi);
  const own = new Int32Array(MAXN * MAXN);
  for (let r = 0; r < runs; r++) {
    // 反复下完随机对局，统计每个点最后归谁
    work.copyFrom(root);
    work.toMove = r & 1 ? WHITE : BLACK; // 轮流先走，不让任何一方多占一手的便宜
    playout(work, true, rng);
    for (let x = 0; x < N; x++)
      for (let y = 0; y < N; y++) {
        const p = work.idx(x, y);
        let c = work.c[p];
        if (c === EMPTY) {
          let seen = 0;
          for (let k = 0; k < 4; k++) {
            const dk = root.dir(k);
            const q = work.col(p + dk);
            if (q === BLACK || q === WHITE) seen |= q;
          }
          c = seen === 3 ? EMPTY : seen;
        }
        own[x * MAXN + y] = (own[x * MAXN + y] ?? 0) + (c === BLACK ? 1 : c === WHITE ? -1 : 0);
      }
  }
  // 一块棋多数子最后都归了对方，就判为死子
  const done = new Uint8Array(MAXN * MAXN),
    dead: { x: number; y: number }[] = [];
  for (let x = 0; x < N; x++)
    for (let y = 0; y < N; y++) {
      const c = b[x * MAXN + y];
      if (c === EMPTY || done[x * MAXN + y]) continue;
      const h = root.hd(root.idx(x, y));
      let s = h,
        total = 0,
        sum = 0;
      const group: { x: number; y: number }[] = [];
      do {
        const sx = (s % root.W) - 1,
          sy = Math.floor(s / root.W) - 1;
        done[sx * MAXN + sy] = 1;
        sum += ((own[sx * MAXN + sy] ?? 0) * (c === BLACK ? 1 : -1)) / runs;
        total++;
        group.push({ x: sx, y: sy });
        s = root.next(s);
      } while (s !== h);
      if (sum / total < -0.05) dead.push(...group);
    }
  return dead;
}
