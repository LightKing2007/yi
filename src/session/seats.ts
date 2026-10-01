/**
 * 座位：一局棋的两方各坐一个座位，座位决定这一方的棋由谁来下。
 *   HumanSeat     本机的人：点棋盘就按规则落子
 *   ComputerSeat  电脑：轮到它时在后台线程里想，想好了落子；可以随时取消
 *   RemoteSeat    联机：自己这一方点棋盘时只把意图发给服务端，服务端确认后由联机模块按规则落子；对方那一方本机不操作
 */
import { now } from '../core/clock';
import type { Game } from '../core/game';
import { goSnap, gomokuSnap } from '../core/snap';
import { GameType, MAXN } from '../core/types';
import type { BoardView } from '../presentation/boardView';
import type { ThinkReply, ThinkRequest } from './think';

export interface Seat {
  readonly kind: 'human' | 'computer' | 'remote';
  /** 这一方由本机的人操作：轮到它时，棋盘点击与“停一手”归它 */
  readonly local: boolean;
  /** 本机的人在 (x, y) 落子；返回是否已经落下（联机时只是发出去，返回 false） */
  play(x: number, y: number): boolean;
  pass(): void;
  /** 每帧 */
  tick?(t: number): void;
  /** 停下正在做的事（电脑停止思考） */
  cancel?(): void;
}

export class HumanSeat implements Seat {
  readonly kind = 'human';
  readonly local = true;
  constructor(private game: Game, private view: BoardView) {}
  play(x: number, y: number) {
    if (!this.game.play(x, y)) return false;
    this.view.aiAt = now() + 0.35;                         // 人机对弈时电脑稍等一下再应
    return true;
  }
  pass() { this.game.pass(); }
}

/** 联机的一方：mine 为自己时，落子与停一手交给 send 发给服务端 */
export class RemoteSeat implements Seat {
  readonly kind = 'remote';
  constructor(readonly local: boolean, private send: { move(x: number, y: number): void; pass(): void } | null) {}
  play(x: number, y: number) { this.send?.move(x, y); return false; }
  pass() { this.send?.pass(); }
}

/** 后台线程的样子（测试里换成同步的假线程） */
export interface WorkerLike {
  postMessage(m: ThinkRequest): void;
  onmessage: ((e: { data: ThinkReply }) => void) | null;
  onerror: ((e: { message: string }) => void) | null;
  terminate(): void;
}

export interface ComputerOptions {
  /** 难度：0 简单 1 普通 2 困难 */
  level: () => number;
  /** 新开一个后台线程 */
  worker: () => WorkerLike;
  /** 后台线程出错 */
  onError?: (message: string) => void;
}

export class ComputerSeat implements Seat {
  readonly kind = 'computer';
  readonly local = false;
  /** 正在想（界面显示“电脑思考中”） */
  thinking = false;
  private worker: WorkerLike | null = null;
  private reqId = 0;
  private pending: { id: number; stamp: string } | null = null;
  private result: { stamp: string; x: number; y: number } | null = null;
  private dead: { id: number; stamp: string } | null = null;

  constructor(private game: Game, private view: BoardView, readonly color: number, private opt: ComputerOptions) {}

  play() { return false; }
  pass() {}

  /** 局面的指纹：想好的结果只用在想它的那个局面上 */
  private stamp() { return String(this.game.ver); }

  private ensureWorker() {
    if (this.worker) return this.worker;
    const w = this.opt.worker();
    w.onerror = e => {                                     // 出错就丢掉这个线程，稍后重新开
      this.opt.onError?.(e.message);
      this.cancel();
      this.view.aiAt = now() + 2;
    };
    w.onmessage = e => this.onReply(e.data);
    return (this.worker = w);
  }

  private onReply(r: ThinkReply) {
    if ('dead' in r) {
      const d = this.dead, g = this.game;
      if (!d || d.id !== r.id) return;
      this.dead = null;
      if (!g.scoring || d.stamp !== this.stamp()) return;  // 点目已经结束或局面变了
      for (const p of r.dead) g.dead[p.x * MAXN + p.y] = 1;
      if (r.dead.length) g.computeScore();
      return;
    }
    if (this.pending && r.id === this.pending.id) { this.result = { stamp: this.pending.stamp, x: r.x, y: r.y }; this.pending = null; }
  }

  /** 轮到电脑：想好了就落子，没想就开始想 */
  tick(t: number) {
    const g = this.game;
    const myTurn = !g.over && !g.scoring && g.cur.toMove === this.color;
    if (!myTurn) { this.thinking = false; return; }
    if (t < this.view.aiAt) return;
    const stamp = this.stamp();
    if (this.result && this.result.stamp === stamp) {
      const { x, y } = this.result;
      this.result = null;
      this.thinking = false;
      if (g.type === GameType.Gomoku) { if (x >= 0) g.play(x, y); }
      else if (x < 0 || !g.play(x, y)) g.pass();
      return;
    }
    if (this.pending && this.pending.stamp === stamp) return;
    const id = ++this.reqId, level = this.opt.level();
    this.pending = { id, stamp };
    this.thinking = true;
    this.ensureWorker().postMessage(g.type === GameType.Go ? { id, kind: 'go', snap: goSnap(g), level } : { id, kind: 'gomoku', snap: gomokuSnap(g), level });
  }

  /** 点目开始时让电脑先估出死子（在后台线程里算，玩家可以再改） */
  estimateDead() {
    const g = this.game, id = ++this.reqId;
    this.dead = { id, stamp: this.stamp() };
    this.ensureWorker().postMessage({ id, kind: 'dead', b: g.cur.b.slice(), N: g.N, komi: g.komi });
  }

  /** 立刻停止思考：后台线程正在算的话直接结束它，下次要用时重新开 */
  cancel() {
    if (this.worker && (this.pending || this.dead)) { this.worker.terminate(); this.worker = null; }
    this.pending = null; this.result = null; this.dead = null;
    this.thinking = false;
  }
}
