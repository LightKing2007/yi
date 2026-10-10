import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/game';
import { BoardView } from '../src/presentation/boardView';
import { goThink } from '../src/core/goAI';
import { gomokuMove } from '../src/core/gomokuAI';
import { renjuForbidden, Renju } from '../src/core/renju';
import { autoMarkDead, goSnap, gomokuSnap } from '../src/core/snap';
import { at, BLACK, EMPTY, GameType, MAXN, WHITE } from '../src/core/types';

const B = BLACK,
  W = WHITE;

function setStones(g: Game, stones: number[]) {
  for (let i = 0; i < stones.length; i += 3) g.cur.b[at(stones[i], stones[i + 1])] = stones[i + 2];
}
function go9() {
  const g = new Game();
  g.newGame(GameType.Go, 9);
  return g;
}
function gomoku15(stones: number[] = []) {
  const g = new Game();
  g.newGame(GameType.Gomoku, 15, { renju: true });
  setStones(g, stones);
  return g;
}
const playAll = (g: Game, mv: number[][]) => mv.forEach(([x, y]) => g.play(x, y));

describe('围棋规则', () => {
  it('角上提一子', () => {
    const g = go9();
    playAll(g, [
      [1, 0],
      [0, 0],
      [0, 1],
    ]);
    expect(g.b(0, 0)).toBe(EMPTY);
    expect(g.cur.cap[BLACK]).toBe(1);
  });
  it('劫', () => {
    const g = go9();
    setStones(g, [1, 0, B, 0, 1, B, 1, 2, B, 2, 0, W, 1, 1, W, 3, 1, W, 2, 2, W]);
    expect(g.play(2, 1) && g.b(1, 1) === EMPTY).toBe(true);
    expect(g.play(1, 1)).toBe(false); // 不能立即回提
    expect(g.play(8, 8) && g.play(7, 7)).toBe(true); // 各找劫材
    expect(g.play(1, 1) && g.b(2, 1) === EMPTY).toBe(true);
  });
  it('禁止自杀，提子优先于自杀', () => {
    let g = go9();
    setStones(g, [1, 0, B, 0, 1, B]);
    g.cur.toMove = W;
    expect(g.play(0, 0)).toBe(false);
    g = go9();
    setStones(g, [1, 0, B, 0, 1, W, 1, 1, W, 2, 0, W]);
    g.cur.toMove = W;
    expect(g.play(0, 0) && g.b(1, 0) === EMPTY).toBe(true);
  });
  it('数子与死子', () => {
    const g = go9();
    for (let y = 0; y < 9; y++) {
      g.cur.b[at(4, y)] = B;
      g.cur.b[at(5, y)] = W;
    }
    g.pass();
    g.pass();
    expect(g.scoring).toBe(true);
    expect([g.scoreB, g.scoreW]).toEqual([45, 43.5]);
    g.cur.b[at(7, 4)] = B;
    g.computeScore();
    g.toggleDead(7, 4);
    expect([g.scoreB, g.scoreW]).toEqual([45, 43.5]);
    g.confirmScore();
    expect(g.over && g.winner === BLACK).toBe(true);
  });
});

describe('五子棋规则', () => {
  it('五连判胜', () => {
    const g = gomoku15();
    playAll(g, [
      [7, 7],
      [0, 0],
      [8, 7],
      [0, 1],
      [9, 7],
      [0, 2],
      [10, 7],
      [0, 3],
      [11, 7],
    ]);
    expect(g.over && g.winner === BLACK && g.win.length === 5).toBe(true);
  });
  it('悔棋把收回的子放进倒流动画（画面层）', () => {
    const g = gomoku15(),
      view = new BoardView();
    g.listener = view;
    playAll(g, [
      [7, 7],
      [8, 8],
    ]);
    g.undo();
    expect(g.b(8, 8)).toBe(EMPTY);
    expect(view.rw).toEqual([{ x: 8, y: 8, c: WHITE, t0: expect.any(Number) }]);
  });
});

describe('画面层按交叉点读取棋子状态', () => {
  it('seedAt、placedAt、appearAt 读取 (x, y) 处的值，未设置与超出范围时为初值', () => {
    const view = new BoardView();
    view.seed[at(3, 4)] = 200;
    view.seed[at(4, 3)] = 9;
    view.placeT[at(3, 4)] = 1.5;
    view.appearT[at(3, 4)] = 2.5;
    expect([view.seedAt(3, 4), view.seedAt(4, 3)]).toEqual([200, 9]);
    expect([view.placedAt(3, 4), view.placedAt(4, 3), view.placedAt(MAXN, MAXN)]).toEqual([1.5, -10, -10]);
    expect([view.appearAt(3, 4), view.appearAt(4, 3), view.appearAt(MAXN, MAXN)]).toEqual([2.5, -10, -10]);
    expect(view.seedAt(MAXN, MAXN)).toBe(0);
  });
});

describe('禁手', () => {
  const cases: [string, number[], [number, number], Renju][] = [
    ['三三', [5, 7, B, 6, 7, B, 7, 5, B, 7, 6, B], [7, 7], Renju.DoubleThree],
    ['四四', [4, 7, B, 5, 7, B, 6, 7, B, 7, 4, B, 7, 5, B, 7, 6, B], [7, 7], Renju.DoubleFour],
    ['一条线上的四四', [3, 7, B, 5, 7, B, 6, 7, B, 9, 7, B], [7, 7], Renju.DoubleFour],
    ['长连', [2, 7, B, 3, 7, B, 4, 7, B, 6, 7, B, 7, 7, B], [5, 7], Renju.Overline],
    ['成五优先于禁手', [3, 7, B, 4, 7, B, 5, 7, B, 6, 7, B, 7, 5, B, 7, 6, B, 8, 6, B, 9, 5, B], [7, 7], Renju.Ok],
    ['四三不是禁手', [4, 7, B, 5, 7, B, 6, 7, B, 3, 7, W, 7, 5, B, 7, 6, B], [7, 7], Renju.Ok],
    ['一头被堵的三不算活三', [5, 7, B, 6, 7, B, 4, 7, W, 7, 5, B, 7, 6, B], [7, 7], Renju.Ok],
    ['原有的活三不构成三三', [2, 2, B, 3, 2, B, 4, 2, B, 5, 7, B, 6, 7, B], [7, 7], Renju.Ok],
    ['活四加冲四也是四四', [4, 7, B, 5, 7, B, 6, 7, B, 7, 4, B, 7, 5, B, 7, 6, B, 7, 3, W], [7, 7], Renju.DoubleFour],
    ['跳活三也算活三', [4, 7, B, 6, 7, B, 7, 5, B, 7, 6, B], [7, 7], Renju.DoubleThree],
  ];
  for (const [name, stones, [x, y], want] of cases)
    it(name, () => {
      const g = gomoku15(stones);
      expect(renjuForbidden(g.cur.b, 15, x, y)).toBe(want);
    });

  it('黑棋下禁手被拒绝，关闭禁手后可以下', () => {
    const g = gomoku15([5, 7, B, 6, 7, B, 7, 5, B, 7, 6, B]);
    const view = new BoardView();
    g.listener = view;
    expect(g.play(7, 7)).toBe(false);
    expect(g.lastReject).toBe('renju-33');
    expect(view.msg?.key).toBe('黑棋不能下三三，这是禁手');
    g.renju = false;
    expect(g.play(7, 7)).toBe(true);
  });
  it('白棋不受禁手限制，白棋长连算胜', () => {
    let g = gomoku15([5, 7, W, 6, 7, W, 7, 5, W, 7, 6, W]);
    g.cur.toMove = W;
    expect(g.play(7, 7)).toBe(true);
    g = gomoku15([2, 7, W, 3, 7, W, 4, 7, W, 6, 7, W, 7, 7, W]);
    g.cur.toMove = W;
    expect(g.play(5, 7) && g.over && g.winner === W).toBe(true);
  });
  it('成五同时另一方向长连：成五优先，黑胜', () => {
    const g = gomoku15([3, 7, B, 4, 7, B, 5, 7, B, 6, 7, B, 7, 2, B, 7, 3, B, 7, 4, B, 7, 5, B, 7, 6, B, 7, 8, B]);
    expect(renjuForbidden(g.cur.b, 15, 7, 7)).toBe(Renju.Ok);
    expect(g.play(7, 7) && g.winner === BLACK).toBe(true);
  });
  it('白棋逼黑棋走禁手点而获胜', () => {
    const g = gomoku15([1, 2, B, 2, 2, W, 3, 2, W, 4, 2, W, 5, 2, W, 6, 3, B, 6, 4, B, 7, 3, B, 8, 4, B]);
    expect(renjuForbidden(g.cur.b, 15, 6, 2)).toBe(Renju.DoubleThree);
    expect(g.play(6, 2)).toBe(false);
    g.play(12, 12);
    expect(g.play(6, 2) && g.over && g.winner === W).toBe(true);
  });
});

describe('五子棋人机', () => {
  const LV = ['简单', '普通', '困难'];
  for (const lv of [1, 2]) {
    it(`${LV[lv]} 堵活三、堵冲四`, () => {
      let g = gomoku15();
      playAll(g, [
        [7, 7],
        [0, 14],
        [8, 7],
        [1, 14],
        [9, 7],
      ]);
      let m = gomokuMove(gomokuSnap(g), lv)!;
      expect((m.x === 6 || m.x === 10) && m.y === 7).toBe(true);
      g = gomoku15();
      playAll(g, [
        [7, 7],
        [0, 14],
        [8, 7],
        [1, 14],
        [9, 7],
        [2, 14],
        [10, 7],
        [6, 7],
      ]);
      m = gomokuMove(gomokuSnap(g), lv)!;
      expect(m).toEqual({ x: 11, y: 7 });
    });
  }
  for (const lv of [0, 1, 2]) {
    it(`${LV[lv]} 优先连五而非防守`, () => {
      for (let rep = 0; rep < (lv ? 1 : 20); rep++) {
        const g = gomoku15();
        playAll(g, [
          [7, 7],
          [3, 3],
          [8, 7],
          [3, 4],
          [9, 7],
          [3, 5],
          [0, 14],
          [3, 6],
          [1, 13],
        ]);
        const m = gomokuMove(gomokuSnap(g), lv)!;
        expect(m.x === 3 && (m.y === 2 || m.y === 7)).toBe(true);
      }
    });
    it(`${LV[lv]} 自我对弈全部合法（禁手开）`, () => {
      const g = gomoku15();
      let moves = 0,
        worst = 0;
      while (!g.over && moves < 80) {
        const t0 = performance.now();
        const m = gomokuMove(gomokuSnap(g), lv);
        worst = Math.max(worst, performance.now() - t0);
        if (!m) break;
        expect(g.b(m.x, m.y)).toBe(EMPTY);
        expect(g.play(m.x, m.y)).toBe(true);
        moves++;
      }
      expect(moves).toBeGreaterThan(8);
      // 困难电脑单步思考的上限；CI 的机器比本机慢两三倍，放宽到 4 秒，免得时快时慢地失败
      if (lv === 2) expect(worst).toBeLessThan(process.env.CI ? 4000 : 1500);
    }, 60000);
  }
});

describe('围棋人机', () => {
  for (const lv of [0, 1, 2]) {
    it(`等级 ${lv} 提掉两子`, () => {
      const g = go9();
      setStones(g, [3, 4, W, 3, 5, W, 5, 4, W, 5, 5, W, 4, 3, W, 6, 6, W, 2, 2, W, 4, 4, B, 4, 5, B, 6, 2, B, 2, 6, B, 7, 7, B]);
      g.cur.toMove = W;
      // 固定模拟次数与种子：结果不随机器快慢变化（TST-020）。按思考时间搜索时，CI 开启覆盖率后模拟次数不足，偶尔落到别处
      expect(goThink(goSnap(g), lv, { iterations: 2000, seed: 1 })).toEqual({ x: 4, y: 6 });
    }, 20000);
  }
  for (const lv of [0, 1]) {
    it(`等级 ${lv} 自我对弈全部合法`, () => {
      const g = go9();
      let moves = 0;
      while (!g.scoring && moves < 150) {
        const m = goThink(goSnap(g), lv, { iterations: 400, seed: moves + 1 }); // 固定模拟次数与种子：结果不随机器快慢变化
        if (m.x < 0) g.pass();
        else expect(g.play(m.x, m.y)).toBe(true);
        moves++;
      }
      expect(moves).toBeGreaterThan(20);
    }, 60000);
  }
  it('点目时自动标出死子', () => {
    const g = go9();
    for (let y = 0; y < 9; y++) {
      g.cur.b[at(3, y)] = B;
      g.cur.b[at(5, y)] = W;
    }
    g.cur.b[at(1, 4)] = W;
    g.cur.b[at(7, 4)] = B;
    g.pass();
    g.pass();
    autoMarkDead(g);
    expect([g.dead[at(1, 4)], g.dead[at(7, 4)], g.dead[at(3, 0)], g.dead[at(5, 0)]]).toEqual([1, 1, 0, 0]);
  });
  it('点目时不把两眼活棋判死', () => {
    const g = go9();
    for (let y = 0; y < 9; y++) {
      g.cur.b[at(2, y)] = B;
      g.cur.b[at(3, y)] = W;
    }
    for (let x = 6; x <= 8; x++) for (let y = 0; y <= 4; y++) g.cur.b[at(x, y)] = B;
    g.cur.b[at(7, 1)] = EMPTY;
    g.cur.b[at(7, 3)] = EMPTY;
    for (let x = 5; x <= 8; x++) g.cur.b[at(x, 5)] = W;
    for (let y = 0; y <= 5; y++) g.cur.b[at(5, y)] = W;
    g.pass();
    g.pass();
    autoMarkDead(g);
    expect([g.dead[at(6, 0)], g.dead[at(2, 0)], g.dead[at(3, 0)]]).toEqual([0, 0, 0]);
  });
});
