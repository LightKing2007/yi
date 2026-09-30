/** 从对局拍下给人机思考用的局面快照（可以交给后台线程），以及点目时自动标死子 */
import type { Game } from './game';
import { estimateDead, type GoSnap } from './goAI';
import type { GomokuSnap } from './gomokuAI';
import { MAXN } from './types';

export function gomokuSnap(g: Game): GomokuSnap {
  return { b: g.cur.b.slice(), N: g.N, me: g.cur.toMove, renju: g.renju };
}

export function goSnap(g: Game): GoSnap {
  const c = g.cur;
  return {
    b: c.b.slice(), N: g.N, toMove: c.toMove, passes: c.passes, moves: c.moves,
    lastX: c.lastX, lastY: c.lastY, komi: g.komi,
    prev: g.hist.length ? g.hist[g.hist.length - 1].b.slice() : null,
  };
}

/** 点目时用随机对局估计每块棋的归属，把多半会被吃掉的棋块标成死子 */
export function autoMarkDead(g: Game) {
  const dead = estimateDead(g.cur.b, g.N, g.komi);
  for (const p of dead) g.dead[p.x * MAXN + p.y] = 1;
  if (dead.length) g.computeScore();
}
