/** 电脑要算的事：五子棋、围棋的下一手，围棋点目时估死子。后台线程（computer.worker.ts）里调用，测试里也可以直接调用 */
import { estimateDead, goThink, type GoSnap } from '../core/goAI';
import { gomokuMove, type GomokuSnap } from '../core/gomokuAI';
import type { Board } from '../core/types';

export type ThinkRequest =
  | { id: number; kind: 'gomoku'; snap: GomokuSnap; level: number }
  | { id: number; kind: 'go'; snap: GoSnap; level: number }
  | { id: number; kind: 'dead'; b: Board; N: number; komi: number };

/** 落点（-1, -1 表示停一手或无处可下），或者估出的死子 */
export type ThinkReply = { id: number; x: number; y: number } | { id: number; dead: { x: number; y: number }[] };

export function think(r: ThinkRequest): ThinkReply {
  if (r.kind === 'dead') return { id: r.id, dead: estimateDead(r.b, r.N, r.komi) };
  const m = r.kind === 'go' ? goThink(r.snap, r.level) : (gomokuMove(r.snap, r.level) ?? { x: -1, y: -1 });
  return { id: r.id, x: m.x, y: m.y };
}
