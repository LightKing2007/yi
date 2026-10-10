/** 对局会话与座位：三种模式下谁来落子、悔棋退几手、电脑思考与取消、点目时估死子、困难电脑的时限 */
import { beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '../src/core/clock';
import { Game } from '../src/core/game';
import { gomokuMove } from '../src/core/gomokuAI';
import { BLACK, EMPTY, GameType, MAXN, WHITE, at } from '../src/core/types';
import { BoardView } from '../src/presentation/boardView';
import type { WorkerLike } from '../src/session/seats';
import { Session } from '../src/session/session';
import { think, type ThinkReply, type ThinkRequest } from '../src/session/think';
import { must } from './must';

let T = 100;

/** 假的后台线程：收到请求先排着，flush() 时才算出结果并回复（模拟“想了一会儿”） */
class FakeWorker implements WorkerLike {
  static all: FakeWorker[] = [];
  onmessage: ((e: { data: ThinkReply }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  queue: ThinkRequest[] = [];
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(m: ThinkRequest) {
    this.queue.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  flush() {
    for (const m of this.queue.splice(0)) if (!this.terminated) this.onmessage?.({ data: think(m) });
  }
}
const flushAll = () => FakeWorker.all.forEach(w => w.flush());

function world(level = 1) {
  const g = new Game(),
    view = new BoardView();
  g.listener = view;
  const s = new Session(g, view, { level: () => level, worker: () => new FakeWorker() });
  return { g, view, s };
}

beforeEach(() => {
  T = 100;
  setClock(() => T);
  FakeWorker.all = [];
});

describe('双人对弈', () => {
  it('两方都由本机的人落子，悔棋退一手', () => {
    const { g, s } = world();
    g.newGame(GameType.Gomoku, 15);
    s.configure('local');
    expect(s.humanTurn()).toBe(true);
    expect(s.play(7, 7)).toBe(true);
    expect(s.humanTurn()).toBe(true);
    expect(s.play(8, 8)).toBe(true);
    expect(s.undoSteps()).toBe(1);
    expect(s.computerTurn()).toBe(false);
  });
});

describe('人机对弈', () => {
  it('人落子后电脑稍等一下再想，想好了落子；轮到人时悔棋连电脑那一手一起退', () => {
    const { g, s } = world();
    g.newGame(GameType.Gomoku, 15);
    s.configure('computer', { computerColor: WHITE });
    expect(s.play(7, 7)).toBe(true);
    expect(s.computerTurn()).toBe(true);
    expect(s.humanTurn()).toBe(false);
    expect(s.play(0, 0)).toBe(false); // 轮到电脑时人不能落子
    s.tick(T); // 刚落子，电脑还在等
    expect(FakeWorker.all.length).toBe(0);
    T += 0.4;
    s.tick(T);
    expect(s.thinking).toBe(true);
    expect(FakeWorker.all[0]?.queue[0]?.kind).toBe('gomoku');
    flushAll();
    s.tick(T);
    expect(g.cur.moves).toBe(2);
    expect(g.cur.toMove).toBe(BLACK);
    expect(s.thinking).toBe(false);
    expect(s.undoSteps()).toBe(2);
    g.undo(s.undoSteps());
    expect(g.cur.moves).toBe(0);
    expect(s.humanTurn()).toBe(true);
  });

  it('电脑执黑时先行', () => {
    const { g, s } = world();
    g.newGame(GameType.Gomoku, 15);
    s.configure('computer', { computerColor: BLACK });
    expect(s.computerTurn()).toBe(true);
    T += 1;
    s.tick(T);
    flushAll();
    s.tick(T);
    expect(g.b(7, 7)).toBe(BLACK);
  });

  it('取消思考：正在算的线程被结束，迟到的结果不会落下；之后重新开线程', () => {
    const { g, s } = world();
    g.newGame(GameType.Gomoku, 15);
    s.configure('computer', { computerColor: WHITE });
    s.play(7, 7);
    T += 0.4;
    s.tick(T);
    const w = must(FakeWorker.all[0], '电脑思考的 Worker');
    expect(w.queue.length).toBe(1);
    g.undo(1);
    s.cancel(); // 电脑还在想时悔棋
    expect(w.terminated).toBe(true);
    expect(s.thinking).toBe(false);
    w.flush();
    s.tick(T);
    expect(g.cur.moves).toBe(0);
    s.play(6, 6);
    T += 0.4;
    s.tick(T);
    expect(FakeWorker.all.length).toBe(2); // 新开的线程
    flushAll();
    s.tick(T);
    expect(g.cur.moves).toBe(2);
  });

  it('局面变了，旧的结果不会用在新局面上', () => {
    const { g, s } = world();
    g.newGame(GameType.Gomoku, 15);
    s.configure('computer', { computerColor: WHITE });
    s.play(7, 7);
    T += 0.4;
    s.tick(T);
    g.undo(1);
    g.play(3, 3); // 不经过会话直接改了局面（例如联机重放）
    flushAll();
    T += 0.4;
    s.tick(T);
    expect(g.b(3, 3)).toBe(BLACK);
    expect(g.cur.moves).toBe(1); // 旧结果被丢掉，电脑重新想
    flushAll();
    s.tick(T);
    expect(g.cur.moves).toBe(2);
  });

  it('人机下围棋：双方停着进入点目时，电脑在后台估出死子', () => {
    const { g, s } = world();
    g.newGame(GameType.Go, 9);
    s.configure('computer', { computerColor: WHITE });
    for (let y = 0; y < 9; y++) {
      g.cur.b[at(3, y)] = BLACK;
      g.cur.b[at(5, y)] = WHITE;
    }
    g.cur.b[at(1, 4)] = WHITE; // 黑地里一颗孤零零的白子
    s.pass();
    s.tick(T);
    g.pass(); // 电脑也停一手
    expect(g.scoring).toBe(true);
    s.tick(T);
    expect(g.dead[1 * MAXN + 4]).toBe(0); // 还没算完
    flushAll();
    expect(g.dead[1 * MAXN + 4]).toBe(1);
    expect(g.scoreB).toBe(9 + 27); // 死子提掉后左边三列都是黑地
  });
});

describe('联机', () => {
  it('自己这一方落子只发给服务端，本地不落；对方的回合、等申请时都不能落', () => {
    const { g, s } = world();
    g.newGame(GameType.Go, 9);
    const sent: string[] = [];
    let canMove = true;
    s.configure('online', { online: { mine: BLACK, move: (x, y) => sent.push(`move ${x},${y}`), pass: () => sent.push('pass'), canMove: () => canMove } });
    expect(s.humanTurn()).toBe(true);
    expect(s.play(4, 4)).toBe(false);
    expect(g.b(4, 4)).toBe(EMPTY);
    s.pass();
    expect(sent).toEqual(['move 4,4', 'pass']);
    canMove = false;
    expect(s.humanTurn()).toBe(false);
    canMove = true;
    g.play(4, 4); // 服务端确认后由联机模块落子
    expect(s.humanTurn()).toBe(false); // 轮到对方
    expect(s.play(5, 5)).toBe(false);
    expect(sent.length).toBe(2);
  });
});

describe('困难电脑的时限', () => {
  it('时间到了就用已经算完的那一层，不会一直想下去', () => {
    // 七手之后轮到白棋：不限时的完整搜索要检查时限 6 次（每 1024 个节点检查一次）
    const b = new Uint8Array(MAXN * MAXN);
    const stones: [number, number, number][] = [
      [7, 7, BLACK],
      [8, 7, WHITE],
      [8, 6, BLACK],
      [6, 8, WHITE],
      [10, 4, BLACK],
      [9, 5, WHITE],
      [7, 6, BLACK],
    ];
    for (const [x, y, c] of stones) b[at(x, y)] = c;
    const snap = { b, N: 15, me: WHITE, renju: true };
    /** 以限时 budgetMs 想一手：时钟每读一次过去 1 毫秒，与机器快慢无关（TST-020）；返回读时钟的次数与落点 */
    const think = (budgetMs: number) => {
      let reads = 0;
      setClock(() => T + reads++ / 1000);
      const move = gomokuMove(snap, 2, () => 0.5, budgetMs);
      return { reads, move };
    };
    // 起算读 1 次，此后每次检查读 1 次：限时 1 毫秒在第 2 次检查时超时，2 毫秒在第 3 次；不限时则要检查 6 次
    const short = think(1),
      longer = think(2);
    expect([short.reads, longer.reads]).toEqual([3, 4]);
    for (const { move } of [short, longer]) expect(move && b[at(move.x, move.y)]).toBe(EMPTY);
  }, 20000); // 开启覆盖率统计时搜索明显变慢，留足余量（TST-024）
});
