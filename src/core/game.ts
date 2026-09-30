/** 对局状态与规则：落子、提子、打劫、点目、悔棋、历史；向应用层发出事件（音效、清理特效由应用层处理） */
import { now } from './clock';
import { renjuForbidden, Renju } from './renju';
import { BLACK, EMPTY, GameType, MAXN, WHITE, at, boardsEqual, clonePos, newBoard, newPos, type Board, type Pos } from './types';

export type GameEvent = { type: 'stone'; strength: number } | { type: 'undo' } | { type: 'reset' };

/** 屏幕上方的提示：文字表里的中文原文（显示时经 T() 翻译） */
export interface Flash { key: string }

export interface FadeStone { x: number; y: number; c: number; t0: number }
/** 悔棋时被收回、正在“倒放”升起消失的棋子 */
export interface RewindStone { x: number; y: number; c: number; t0: number }

/** 切换棋盘 / 新局的过渡：记下旧棋盘，旧棋子由中心向外依次升起淡去 */
export interface BoardSwitch { t0: number; N: number; b: Board; seed: Uint8Array }
export const SWITCH_T = 0.7;

const HISTMAX = 1024;
const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
const WIN_DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]] as const;

export const RENJU_NAMES: Record<number, string> = { [Renju.Overline]: '长连', [Renju.DoubleFour]: '四四', [Renju.DoubleThree]: '三三' };

export interface NewGameOptions { renju?: boolean; vsAI?: boolean; aiColor?: number }

export class Game {
  type = GameType.Gomoku;
  N = 15;
  goSize = 19;
  vsAI = false;
  aiColor = WHITE;
  /** 本局五子棋是否执行黑棋禁手 */
  renju = true;
  /** 落子类动画的时长倍率（设置里的动画速度） */
  animK = 1;
  cur: Pos = newPos();
  hist: Pos[] = [];
  over = false;
  winner = 0;                  // 1 黑 2 白 3 和
  win: { x: number; y: number }[] = [];
  winT = 0;                    // 五子连珠的时刻，驱动胜利动画；0 表示无
  winBurst = 0;
  review = false;              // 胜利后其余棋子被炸飞；true = 让它们飞回原位以查看棋局
  blowView = 1;                // 炸飞程度的动画值：1 炸飞，0 还原
  undoPending = false;         // 炸飞状态下悔棋：先让棋子飞回原位，再真正悔棋
  goEndT = 0;                  // 围棋确认结果的时刻，驱动“胜负揭晓”动画
  goBurst = 0;
  forfeit = false;             // 联机时因认输、超时、离开而结束
  appearT = new Float32Array(MAXN * MAXN);
  rw: RewindStone[] = [];
  scoring = false;
  finished = false;
  dead = newBoard();
  terr = newBoard();
  scoreB = 0;
  scoreW = 0;
  komi = 7.5;
  placeT = new Float32Array(MAXN * MAXN);
  seed = new Uint8Array(MAXN * MAXN);
  fades: FadeStone[] = [];
  aiAt = 0;
  msg: Flash | null = null;
  msgAt = 0;
  switch: BoardSwitch = { t0: -100, N: 15, b: newBoard(), seed: new Uint8Array(MAXN * MAXN) };

  private events: GameEvent[] = [];
  private forbidCache = { stamp: -1, map: new Uint8Array(MAXN * MAXN) };

  constructor() { this.newGame(GameType.Gomoku, 15); this.switch.t0 = -100; this.events.length = 0; }

  pollEvent(): GameEvent | undefined { return this.events.shift(); }
  eventMark() { return this.events.length; }
  eventRewind(mark: number) { if (mark >= 0 && mark < this.events.length) this.events.length = mark; }
  private push(e: GameEvent) { if (this.events.length < 16) this.events.push(e); }
  private flash(key: string) { this.msg = { key }; this.msgAt = now(); }

  b(x: number, y: number) { return this.cur.b[x * MAXN + y]; }
  inB(x: number, y: number) { return x >= 0 && y >= 0 && x < this.N && y < this.N; }

  newGame(type: GameType, N: number, opt: NewGameOptions = {}) {
    if (this.N > 0) this.switch = { t0: now(), N: this.N, b: this.cur.b.slice(), seed: this.seed.slice() };
    this.cur = newPos();
    this.type = type;
    this.N = N;
    if (type === GameType.Go) this.goSize = N;
    this.hist = []; this.fades = [];
    this.over = false; this.winner = 0; this.win = [];
    this.winT = 0; this.winBurst = 0; this.review = false; this.blowView = 1; this.forfeit = false;
    this.push({ type: 'reset' });
    this.scoring = this.finished = false;
    this.komi = 7.5;
    if (opt.renju !== undefined) this.renju = opt.renju;
    if (opt.vsAI !== undefined) this.vsAI = opt.vsAI;
    if (opt.aiColor !== undefined) this.aiColor = opt.aiColor;
    this.dead.fill(0); this.terr.fill(0);
    this.placeT.fill(-10); this.appearT.fill(-10);
    for (let i = 0; i < this.seed.length; i++) this.seed[i] = (Math.random() * 256) | 0;
    this.goEndT = 0; this.goBurst = 0; this.rw = []; this.undoPending = false;
    this.msg = null;
    this.aiAt = now() + 0.6;                       // 玩家执白时电脑先行，稍等一下再落子
  }

  /** 人机对弈且此刻轮到电脑落子 */
  aiToMove() { return this.vsAI && !this.over && !this.scoring && this.cur.toMove === this.aiColor; }

  /** 当前局面下黑棋在 (x, y) 是否为禁手（按局面缓存整盘） */
  forbiddenAt(x: number, y: number): Renju {
    if (this.type !== GameType.Gomoku || !this.renju || this.over || this.cur.toMove !== BLACK || !this.inB(x, y)) return Renju.Ok;
    let h = 2166136261;
    for (let i = 0; i < this.N; i++) for (let j = 0; j < this.N; j++) h = Math.imul(h ^ this.cur.b[i * MAXN + j], 16777619) >>> 0;
    h = (h ^ Math.imul(this.N, 7919)) >>> 0;
    const c = this.forbidCache;
    if (h !== c.stamp) {
      c.stamp = h;
      for (let i = 0; i < this.N; i++) for (let j = 0; j < this.N; j++)
        c.map[i * MAXN + j] = this.cur.b[i * MAXN + j] === EMPTY ? renjuForbidden(this.cur.b, this.N, i, j) : 0;
    }
    return c.map[x * MAXN + y];
  }

  /** 取棋块：返回气数与棋块坐标 */
  private group(b: Board, x: number, y: number) {
    const seen = new Uint8Array(MAXN * MAXN);
    const c = b[at(x, y)], xs = [x], ys = [y];
    let libs = 0;
    seen[at(x, y)] = 1;
    for (let head = 0; head < xs.length; head++) {
      const cx = xs[head], cy = ys[head];
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d], ny = cy + DY[d];
        if (!this.inB(nx, ny) || seen[at(nx, ny)]) continue;
        const v = b[at(nx, ny)];
        if (v === EMPTY) { libs++; seen[at(nx, ny)] = 2; }
        else if (v === c) { seen[at(nx, ny)] = 1; xs.push(nx); ys.push(ny); }
      }
    }
    return { libs, xs, ys };
  }

  private pushHist() { if (this.hist.length < HISTMAX) this.hist.push(clonePos(this.cur)); }

  private gomokuCheckWin(x: number, y: number) {
    const b = this.cur.b, c = b[at(x, y)];
    for (const [dx, dy] of WIN_DIRS) {
      let a = 0, bb = 0;
      while (this.inB(x + (a + 1) * dx, y + (a + 1) * dy) && b[at(x + (a + 1) * dx, y + (a + 1) * dy)] === c) a++;
      while (this.inB(x - (bb + 1) * dx, y - (bb + 1) * dy) && b[at(x - (bb + 1) * dx, y - (bb + 1) * dy)] === c) bb++;
      const n = a + bb + 1;
      if (n === 5 || (n > 5 && !(this.renju && c === BLACK))) {   // 禁手规则下黑棋长连不算胜
        this.win = [];
        for (let k = -bb; k <= a; k++) this.win.push({ x: x + k * dx, y: y + k * dy });
        return true;
      }
    }
    return false;
  }

  /** 数子法：活子 + 只被一方包围的空点；白方加贴目 */
  computeScore() {
    const N = this.N, t = this.cur.b.slice();
    for (let i = 0; i < t.length; i++) if (this.dead[i]) t[i] = EMPTY;
    const vis = new Uint8Array(MAXN * MAXN);
    this.terr.fill(0);
    let aliveB = 0, aliveW = 0, terB = 0, terW = 0;
    for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) {
      const v = t[at(x, y)];
      if (v === BLACK) aliveB++;
      else if (v === WHITE) aliveW++;
      else if (!vis[at(x, y)]) {
        const qx = [x], qy = [y];
        let border = 0;
        vis[at(x, y)] = 1;
        for (let h = 0; h < qx.length; h++) {
          for (let d = 0; d < 4; d++) {
            const nx = qx[h] + DX[d], ny = qy[h] + DY[d];
            if (!this.inB(nx, ny)) continue;
            const w = t[at(nx, ny)];
            if (w === EMPTY) { if (!vis[at(nx, ny)]) { vis[at(nx, ny)] = 1; qx.push(nx); qy.push(ny); } }
            else border |= w;
          }
        }
        const owner = border === BLACK ? BLACK : border === WHITE ? WHITE : 0;
        for (let i = 0; i < qx.length; i++) this.terr[at(qx[i], qy[i])] = owner;
        if (owner === BLACK) terB += qx.length; else if (owner === WHITE) terW += qx.length;
      }
    }
    this.scoreB = aliveB + terB;
    this.scoreW = aliveW + terW + this.komi;
  }

  /** 落子；不合法返回 false（并给出提示） */
  play(x: number, y: number): boolean {
    if (this.over || this.scoring || !this.inB(x, y) || this.b(x, y) !== EMPTY) return false;
    const c = this.cur.toMove, o = 3 - c, t = now();

    if (this.type === GameType.Gomoku) {
      const why = this.renju && c === BLACK ? renjuForbidden(this.cur.b, this.N, x, y) : Renju.Ok;
      if (why) { this.flash('禁手：黑棋不能下' + RENJU_NAMES[why]); return false; }
      this.pushHist();
      this.cur.b[at(x, y)] = c;
      this.cur.lastX = x; this.cur.lastY = y; this.cur.moves++;
      this.placeT[at(x, y)] = t;
      this.seed[at(x, y)] = (Math.random() * 256) | 0;
      if (this.gomokuCheckWin(x, y)) { this.over = true; this.winner = c; this.winT = t; this.winBurst = 0; this.review = false; this.blowView = 1; }
      else if (this.cur.moves >= this.N * this.N) { this.over = true; this.winner = 3; }
      this.cur.toMove = o;
      this.push({ type: 'stone', strength: 0.9 });
      return true;
    }

    // 围棋
    const next = clonePos(this.cur);
    next.b[at(x, y)] = c;
    const caps: { x: number; y: number }[] = [];
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d];
      if (!this.inB(nx, ny) || next.b[at(nx, ny)] !== o) continue;
      const g = this.group(next.b, nx, ny);
      if (g.libs === 0) for (let i = 0; i < g.xs.length; i++) { next.b[at(g.xs[i], g.ys[i])] = EMPTY; caps.push({ x: g.xs[i], y: g.ys[i] }); }
    }
    if (this.group(next.b, x, y).libs === 0) { this.flash('禁着点：不可自杀'); return false; }
    if (this.hist.length > 0 && boardsEqual(next.b, this.hist[this.hist.length - 1].b)) { this.flash('劫争：此处暂不可提，请先在别处落子'); return false; }

    this.pushHist();
    next.cap[c] += caps.length;
    next.lastX = x; next.lastY = y;
    next.passes = 0;
    next.moves++;
    next.toMove = o;
    this.cur = next;
    this.placeT[at(x, y)] = t;
    this.seed[at(x, y)] = (Math.random() * 256) | 0;
    for (const p of caps) if (this.fades.length < 512) this.fades.push({ x: p.x, y: p.y, c: o, t0: t + 0.08 });
    this.push({ type: 'stone', strength: caps.length ? 1.0 : 0.9 });
    return true;
  }

  pass() {
    if (this.type !== GameType.Go || this.over || this.scoring) return;
    this.pushHist();
    this.cur.passes++;
    this.cur.moves++;
    this.cur.lastX = this.cur.lastY = -1;
    this.flash(this.cur.toMove === BLACK ? '黑方停一手' : '白方停一手');
    this.cur.toMove = 3 - this.cur.toMove;
    this.aiAt = now() + 0.35;
    if (this.cur.passes >= 2) {
      this.scoring = true;
      this.dead.fill(0);
      this.computeScore();
      this.msg = null;
    }
  }

  undo() {
    if (this.hist.length === 0) return;
    // 人机对弈：若轮到玩家，要连电脑那一手一起退，退完仍是玩家落子
    const steps = this.vsAI && this.cur.toMove !== this.aiColor && this.hist.length >= 2 ? 2 : 1;
    const old = this.cur, wasFinished = this.finished;
    for (let i = 0; i < steps && this.hist.length > 0; i++) this.cur = this.hist.pop()!;

    // 时光倒流：收回的棋子升起消失（最后一手先走），被提的子随后淡入，点目时化去的死子也回来
    const t = now();
    this.rw = [];
    for (let x = 0; x < this.N; x++) for (let y = 0; y < this.N; y++) {
      const i = at(x, y);
      if (old.b[i] && !this.cur.b[i]) {
        if (this.rw.length < 8) this.rw.push({ x, y, c: old.b[i], t0: t + (x === old.lastX && y === old.lastY ? 0 : 0.14 * this.animK) });
      } else if (!old.b[i] && this.cur.b[i]) this.appearT[i] = t + 0.3 * this.animK;
      else if (wasFinished && this.dead[i]) this.appearT[i] = t;
    }
    if (this.rw.length) this.push({ type: 'undo' });
    this.goEndT = 0; this.goBurst = 0; this.undoPending = false;
    this.over = false; this.winner = 0; this.win = [];
    this.winT = 0; this.winBurst = 0; this.review = false; this.blowView = 1; this.forfeit = false;
    this.push({ type: 'reset' });
    this.scoring = this.finished = false;
    this.fades = [];
    this.dead.fill(0); this.terr.fill(0);
    this.placeT.fill(-10);
    this.aiAt = now() + 0.4;
  }

  toggleDead(x: number, y: number) {
    if (!this.inB(x, y) || this.b(x, y) === EMPTY) return;
    const g = this.group(this.cur.b, x, y), v = this.dead[at(x, y)] ? 0 : 1;
    for (let i = 0; i < g.xs.length; i++) this.dead[at(g.xs[i], g.ys[i])] = v;
    this.computeScore();
    this.push({ type: 'stone', strength: 0.35 });
  }

  confirmScore() {
    this.scoring = false;
    this.finished = true;
    this.over = true;
    this.winner = this.scoreB > this.scoreW ? BLACK : WHITE;
    this.goEndT = now();
    this.goBurst = 0;
  }

  resume() {
    this.scoring = false;
    this.cur.passes = 0;
    this.dead.fill(0); this.terr.fill(0);
  }

  /** 胜方最后落下的一子（找不到就取天元） */
  private winnerLastStone(winner: number) {
    const cur = this.cur;
    if (cur.lastX >= 0 && cur.b[at(cur.lastX, cur.lastY)] === winner) return { x: cur.lastX, y: cur.lastY };
    for (let i = this.hist.length - 1; i >= 0; i--) {
      const after = i + 1 < this.hist.length ? this.hist[i + 1] : cur;
      const lx = after.lastX, ly = after.lastY;
      if (lx >= 0 && after.b[at(lx, ly)] === winner && cur.b[at(lx, ly)] === winner) return { x: lx, y: ly };
    }
    return { x: this.N >> 1, y: this.N >> 1 };
  }

  /** 不是下出来的胜负（认输、超时、掉线、离开）：结束对局并触发终局动画 */
  forfeitEnd(winner: number) {
    if (this.over && !this.scoring) return;
    let stones = 0;
    for (let x = 0; x < this.N; x++) for (let y = 0; y < this.N; y++) if (this.b(x, y)) stones++;
    this.over = true;
    this.winner = winner;
    if (winner !== BLACK && winner !== WHITE) return;
    if (!stones) return;
    this.forfeit = true;
    if (this.type === GameType.Gomoku) {
      this.win = [this.winnerLastStone(winner)];
      this.winT = now(); this.winBurst = 0; this.review = false; this.blowView = 1;
    } else {
      this.scoring = false;
      this.dead.fill(0); this.terr.fill(0);
      this.goEndT = now(); this.goBurst = 0;
    }
  }
}
