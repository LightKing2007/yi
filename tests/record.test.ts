/** 规则层（纯函数）与棋谱：每种不合法原因、不改动传入的局面、回放可复现、长局、黑棋无处可下 */
import { describe, expect, it } from 'vitest';
import { gameConfig } from '../src/core/config';
import { Game } from '../src/core/game';
import { BoardView } from '../src/presentation/boardView';
import type { Move } from '../src/core/move';
import { replay, type GameRecord } from '../src/core/record';
import { applyMove, forbiddenAt, gomokuHasMove } from '../src/core/rules';
import { BLACK, EMPTY, GameType, Rng, WHITE, at, newPos, type Pos } from '../src/core/types';

const B = BLACK, W = WHITE;
const gomoku = gameConfig(GameType.Gomoku, 15, true);
const go9 = gameConfig(GameType.Go, 9);

function posWith(stones: number[], toMove = BLACK): Pos {
  const p = newPos();
  for (let i = 0; i < stones.length; i += 3) p.b[at(stones[i], stones[i + 1])] = stones[i + 2];
  p.toMove = toMove;
  return p;
}
const play = (x: number, y: number): Move => ({ k: 'play', x, y });
const why = (r: ReturnType<typeof applyMove>) => (r.ok ? 'ok' : r.why);

describe('规则层：不合法的原因', () => {
  it('棋盘外、已有棋子、五子棋停着', () => {
    const p = posWith([7, 7, B]);
    expect(why(applyMove(gomoku, p, play(15, 0), null))).toBe('off-board');
    expect(why(applyMove(gomoku, p, play(-1, 3), null))).toBe('off-board');
    expect(why(applyMove(gomoku, p, play(7, 7), null))).toBe('occupied');
    expect(why(applyMove(gomoku, p, { k: 'pass' }, null))).toBe('pass-not-allowed');
  });
  it('三种禁手；白棋与关闭禁手时不受限', () => {
    expect(why(applyMove(gomoku, posWith([5, 7, B, 6, 7, B, 7, 5, B, 7, 6, B]), play(7, 7), null))).toBe('renju-33');
    expect(why(applyMove(gomoku, posWith([4, 7, B, 5, 7, B, 6, 7, B, 7, 4, B, 7, 5, B, 7, 6, B]), play(7, 7), null))).toBe('renju-44');
    expect(why(applyMove(gomoku, posWith([2, 7, B, 3, 7, B, 4, 7, B, 6, 7, B, 7, 7, B]), play(5, 7), null))).toBe('renju-overline');
    expect(why(applyMove(gomoku, posWith([5, 7, W, 6, 7, W, 7, 5, W, 7, 6, W], WHITE), play(7, 7), null))).toBe('ok');
    expect(why(applyMove(gameConfig(GameType.Gomoku, 15, false), posWith([5, 7, B, 6, 7, B, 7, 5, B, 7, 6, B]), play(7, 7), null))).toBe('ok');
    expect(forbiddenAt(gomoku, posWith([5, 7, B, 6, 7, B, 7, 5, B, 7, 6, B]), 7, 7)).toBe('renju-33');
    expect(forbiddenAt(gomoku, posWith([5, 7, B, 6, 7, B, 7, 5, B, 7, 6, B], WHITE), 7, 7)).toBeNull();
  });
  it('围棋：自杀与打劫', () => {
    expect(why(applyMove(go9, posWith([1, 0, B, 0, 1, B], WHITE), play(0, 0), null))).toBe('suicide');
    // 黑提劫之后，白不能立即回提
    const p = posWith([1, 0, B, 0, 1, B, 1, 2, B, 2, 0, W, 1, 1, W, 3, 1, W, 2, 2, W]);
    const r = applyMove(go9, p, play(2, 1), null);
    expect(r.ok && r.v.captured).toEqual([{ x: 1, y: 1 }]);
    if (!r.ok) return;
    expect(why(applyMove(go9, r.v.pos, play(1, 1), p.b))).toBe('ko');
  });
});

describe('规则层：纯函数', () => {
  it('不改动传入的局面', () => {
    const p = posWith([1, 0, B, 0, 1, W, 1, 1, W, 2, 0, W], WHITE), before = p.b.slice(), moves = p.moves;
    const r = applyMove(go9, p, play(0, 0), null);
    expect(r.ok).toBe(true);
    expect(p.b).toEqual(before);
    expect(p.moves).toBe(moves);
    expect(p.toMove).toBe(WHITE);
  });
  it('同一份棋谱回放两次，结果逐字节相同', () => {
    const rng = new Rng(7), cfg = gameConfig(GameType.Go, 13);
    const rec: GameRecord = { cfg, moves: [] };
    let pos = newPos(), prev: Uint8Array | null = null;
    let fails = 0;
    while (rec.moves.length < 300) {                                  // 随机落子，连续落不下去就停一手
      const m: Move = ++fails > 40 ? { k: 'pass' } : play(rng.int(0, 12), rng.int(0, 12));
      const r = applyMove(cfg, pos, m, prev);
      if (!r.ok) continue;
      fails = 0;
      rec.moves.push({ m });
      prev = pos.b; pos = r.v.pos;
    }
    const a = replay(rec), b = replay(rec);
    expect(a.pos.b).toEqual(pos.b);
    expect(b.pos.b).toEqual(a.pos.b);
    expect(a.pos.cap).toEqual(pos.cap);
    expect(a.history.length).toBe(300);
  });
});

describe('对局：棋谱与长局', () => {
  it('每一手都记入棋谱，悔棋同时退掉', () => {
    const g = new Game();
    g.newGame(GameType.Go, 9);
    g.play(2, 2); g.play(6, 6); g.pass();
    expect(g.moves.map(r => r.m)).toEqual([play(2, 2), play(6, 6), { k: 'pass' }]);
    g.undo();
    expect(g.moves.length).toBe(2);
    expect(replay({ cfg: g.cfg, moves: g.moves }).pos.b).toEqual(g.cur.b);
  });
  it('超过 1024 手的长局也能一路悔回空盘', () => {
    const g = new Game(), rng = new Rng(11);
    g.newGame(GameType.Go, 19);
    let fails = 0;
    while (g.moves.length < 1100) {                                   // 随机落子；连续落不下去就停一手（棋盘满了靠提子腾地方）
      if (g.play(rng.int(0, 18), rng.int(0, 18))) fails = 0;
      else if (++fails > 40) { g.pass(); fails = 0; }
      if (g.scoring) g.resume();
    }
    expect(replay({ cfg: g.cfg, moves: g.moves }).pos.b).toEqual(g.cur.b);
    while (g.hist.length) g.undo();
    expect(g.cur.b.every(v => v === EMPTY)).toBe(true);
    expect(g.moves.length).toBe(0);
  }, 20000);
  it('不合法的原因记在 lastReject，提示文字不变', () => {
    const g = new Game(), view = new BoardView();
    g.listener = view;
    g.newGame(GameType.Gomoku, 15, { renju: true });
    g.play(7, 7);
    expect(g.play(7, 7)).toBe(false);
    expect(g.lastReject).toBe('occupied');
    expect(view.msg).toBeNull();                                  // 下在已有子的地方不提示
  });
});

describe('禁手下黑棋无处可下', () => {
  /** 整盘铺满且没有任何一方连成五子：按 (x + 2y) mod 4 排成 黑黑白白，横竖斜最长只连两子 */
  function nearlyFull() {
    const p = newPos();
    for (let x = 0; x < 15; x++) for (let y = 0; y < 15; y++) p.b[at(x, y)] = (x + 2 * y) % 4 < 2 ? B : W;
    for (const x of [3, 4, 5, 7, 8]) p.b[at(x, 7)] = B;                 // 第 7 行：黑黑黑 _ 黑黑，空点下黑是长连
    p.b[at(6, 7)] = EMPTY;
    p.b[at(14, 14)] = EMPTY;                                           // 留给白棋的最后一手
    p.moves = 223;
    p.toMove = W;
    return p;
  }
  it('白棋下完最后一个非禁手点，黑棋只剩禁手：判和棋', () => {
    const p = nearlyFull();
    expect(forbiddenAt(gomoku, { ...p, toMove: B }, 6, 7)).toBe('renju-overline');
    const r = applyMove(gomoku, p, play(14, 14), null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.v.line).toBeNull();
    expect(r.v.result).toEqual({ winner: 3, reason: 'full' });
    expect(gomokuHasMove(gomoku, r.v.pos)).toBe(false);
    expect(gomokuHasMove(gameConfig(GameType.Gomoku, 15, false), r.v.pos)).toBe(true);
  });
});
