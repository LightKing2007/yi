/** 棋谱：一局的规则设置加上依次走过的每一手。局面都可以由它从头回放得到 */
import type { GameConfig } from './config';
import type { Move, Result } from './move';
import { applyMove, type Applied } from './rules';
import { newPos, type Pos } from './types';

/** 一手棋；ms 是这一手用了多少毫秒（联机时由服务端记录） */
export interface MoveRec {
  m: Move;
  ms?: number;
}

export interface GameRecord {
  cfg: GameConfig;
  moves: MoveRec[];
  /** 点目确认时标记的死子 */
  dead?: { x: number; y: number }[];
  result?: Result;
}

/** 从头回放：history[i] 是第 i 手之前的局面（history[0] 为空盘），pos 是最后的局面；遇到不合法的一手时抛出 */
export function replay(rec: GameRecord): { history: Pos[]; pos: Pos; last: Applied | null } {
  let pos = newPos(),
    last: Applied | null = null;
  const history: Pos[] = [];
  for (let i = 0; i < rec.moves.length; i++) {
    const r = applyMove(rec.cfg, pos, rec.moves[i].m, history.length ? history[history.length - 1].b : null);
    if (!r.ok) throw new Error(`棋谱第 ${i + 1} 手不合法：${r.why}`);
    history.push(pos);
    pos = r.v.pos;
    last = r.v;
  }
  return { history, pos, last };
}
